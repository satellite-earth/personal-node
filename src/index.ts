import 'dotenv/config.js';
import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { useWebSocketImplementation } from 'nostr-tools';

import { DesktopBlobServer, NostrRelay, terminateConnectionsInterval } from '@satellite-earth/core';
import App from './app/index.js';
import { PORT, DATA_PATH, AUTH } from './env.js';
import { LocalStorage, BlossomSQLite } from 'blossom-server-sdk';
import { CommunityMultiplexer } from './modules/community-multiplexer.js';
import { logger } from './logger.js';

// @ts-expect-error
global.WebSocket = WebSocket;

useWebSocketImplementation(WebSocket);

const server = createServer();
const wss = new WebSocketServer({ server });

// Fix CORS for websocket
wss.on('headers', (headers, request) => {
	headers.push('Access-Control-Allow-Origin: *');
});

// NOTE: this might not make sense for personal node
terminateConnectionsInterval(wss, 30000);

const app = new App(DATA_PATH);

app.control.attachToServer(wss);

const communityMultiplexer = new CommunityMultiplexer(app.database.db, app.eventStore);

const relay = new NostrRelay(app.eventStore);
relay.sendChallenge = true;
relay.requireRelayInAuth = false;

// only allow the owner to NIP-42 authenticate with the relay
relay.checkAuth = (ws, auth) => {
	if (auth.pubkey !== app.config.config.owner) return 'Pubkey dose not match owner';
	return true;
};

// when the owner authenticates add the socket to the list of authorized connections for control api
relay.on('socket:auth', (ws, auth) => {
	if (auth.pubkey === app.config.config.owner) {
		app.control.authorizedConnections.add(ws);
	}
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

const blobStorage = new LocalStorage(path.join(DATA_PATH, 'blobs'));
await blobStorage.setup();

const blobServer = new DesktopBlobServer(blobStorage, blobMetadata);

// Create http server
const expressServer = express();

expressServer.use(blobServer.router);

// redirect to dashboard ui when root page is loaded
expressServer.get('/', (req, res, next) => {
	if (!req.url.includes(`auth=`)) {
		const params = new URLSearchParams();
		params.set('auth', app.config.config.dashboardAuth);
		res.redirect('/?' + params.toString());
	}
	next();
});

// host the dashboard-ui for the node
expressServer.use(express.static('../dashboard-ui/dist'));

server.on('request', expressServer);

app.start();

// Listen for http connections
server.listen(PORT, () => {
	logger(`server running on`, PORT);
	logger('AUTH', app.config.config.dashboardAuth);
});

// shutdown process
async function shutdown() {
	logger('shutting down');

	app.stop();
	relay.stop();
	communityMultiplexer.stop();
	server.close();

	process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
