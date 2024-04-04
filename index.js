import 'dotenv/config.js';
import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import path from 'path';

import {
	DesktopBlobServer,
	terminateConnectionsInterval,
} from '../core/dist/index.js';
import App from './app/index.js';
import { PORT, DATA_PATH, AUTH, HTTP_PORT } from './env.js';
import { LocalStorage, BlossomSQLite } from 'blossom-server-sdk';

// Needed for nostr-tools relay lib
global.WebSocket = WebSocket;

// Create websocket server
const wss = new WebSocketServer({
	port: PORT,
});

// NOTE: this might not make sense for personal node
terminateConnectionsInterval(wss, 30000);

const app = new App({
	path: DATA_PATH,
	auth: AUTH,
});

app.relay.attachToServer(wss);
app.control.attachToServer(wss);

const blobMetadata = new BlossomSQLite(app.database.db);

const blobStorage = new LocalStorage(path.join(app.config.path, 'blobs'));
await blobStorage.setup();

const blobServer = new DesktopBlobServer(blobStorage, blobMetadata);

// Fix CORS for websocket
wss.on('headers', (headers, request) => {
	headers.push('Access-Control-Allow-Origin: *');
});

// Allow parent (if any) to tell the node to shut itself
// down gracefully instead of just killing the process
process.on('SIGINT', () => {
	console.log('instance got SIGINT');
	app.stop();
	process.exit(0);
});

// Create http server
const httpServer = express();

httpServer.use(blobServer.router);

app.start();

// Listen for http connections
httpServer.listen(HTTP_PORT, () => {
	console.log(`http server running on`, HTTP_PORT);
});
