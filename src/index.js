import 'dotenv/config.js';
import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import path from 'path';
import { createServer } from 'http';

import { DesktopBlobServer, NostrRelay, terminateConnectionsInterval } from '../../core/dist/index.js';
import App from './app/index.js';
import { PORT, DATA_PATH, AUTH } from './env.js';
import { LocalStorage, BlossomSQLite } from 'blossom-server-sdk';
import { LabeledEventStore } from './modules/labeled-event-store.js';
import { CommunityMultiplexer } from './modules/community-multiplexer.js';
import { logger } from './logger.js';
import { useWebSocketImplementation } from 'nostr-tools';

// Needed for nostr-tools relay lib
global.WebSocket = WebSocket;

useWebSocketImplementation(WebSocket);

const server = createServer();
const wss = new WebSocketServer({ server });

// NOTE: this might not make sense for personal node
terminateConnectionsInterval(wss, 30000);

const app = new App({
	path: DATA_PATH,
	auth: AUTH,
});

app.control.attachToServer(wss);

// create default relay
const defaultEventStore = new LabeledEventStore(app.database.db, 'default');
defaultEventStore.setup();
defaultEventStore.readAll = true;

const communityMultiplexer = new CommunityMultiplexer(app.database.db, defaultEventStore);

const relay = new NostrRelay(defaultEventStore);

// Fix CORS for websocket
wss.on('headers', (headers, request) => {
	headers.push('Access-Control-Allow-Origin: *');
});

wss.on('connection', async (ws, req) => {
	if (req.url === '/') return relay.handleConnection(ws, req);

	try {
		const handled = communityMultiplexer.handleConnection(ws, req);
		if (!handled) relay.handleConnection(ws, req);
	} catch (e) {
		console.log('Failed to handle community connection');
		console.log(e);
	}
});

const blobMetadata = new BlossomSQLite(app.database.db);

const blobStorage = new LocalStorage(path.join(app.config.path, 'blobs'));
await blobStorage.setup();

const blobServer = new DesktopBlobServer(blobStorage, blobMetadata);

// Allow parent (if any) to tell the node to shut itself
// down gracefully instead of just killing the process
process.on('SIGINT', () => {
	logger('instance got SIGINT');
	app.stop();
	relay.stop();
	communityMultiplexer.stop();
	process.exit(0);
});

// Create http server
const httpServer = express();
server.on('request', httpServer);

httpServer.use(blobServer.router);

app.start();

// Listen for http connections
server.listen(PORT, () => {
	console.log(`server running on`, PORT);
});
