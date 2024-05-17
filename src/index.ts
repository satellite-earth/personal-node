#!/bin/env node
import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { useWebSocketImplementation } from 'nostr-tools';
import { mkdirp } from 'mkdirp';
import { DesktopBlobServer, terminateConnectionsInterval } from '@satellite-earth/core';
import { resolve as importMetaResolve } from 'import-meta-resolve';

import App from './app/index.js';
import { PORT, DATA_PATH, AUTH } from './env.js';
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

await mkdirp(DATA_PATH);
const app = new App(DATA_PATH);
const communityMultiplexer = new CommunityMultiplexer(app.database.db, app.eventStore);

app.control.attachToServer(wss);
wss.on('connection', async (ws, req) => {
	if (req.url === '/') return app.relay.handleConnection(ws, req);

	try {
		const handled = communityMultiplexer.handleConnection(ws, req);
		if (!handled) app.relay.handleConnection(ws, req);
	} catch (e) {
		console.log('Failed to handle community connection');
		console.log(e);
	}
});

await app.blobStorage.setup();

const blobServer = new DesktopBlobServer(app.blobStorage, app.blobMetadata);

// Create http server
const expressServer = express();

expressServer.use(blobServer.router);

// host the community-ui for the node
const appDir = path.dirname(importMetaResolve('@satellite-earth/web-ui', import.meta.url).replace('file://', ''));
expressServer.use(express.static(appDir));
expressServer.get('*', (req, res) => {
	res.sendFile(path.resolve(appDir, 'index.html'));
});

server.on('request', expressServer);

app.start();

// Listen for http connections
server.listen(PORT, () => {
	logger(`server running on`, PORT);
	logger('AUTH', AUTH);

	if (process.send) process.send({ type: 'RELAY_READY' });
});

// shutdown process
async function shutdown() {
	logger('shutting down');

	app.stop();
	communityMultiplexer.stop();
	server.close();

	process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
