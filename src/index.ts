#!/bin/env node
import process from 'node:process';
import WebSocket, { WebSocketServer } from 'ws';
import express, { Request } from 'express';
import path from 'node:path';
import { createServer } from 'node:http';
import { mkdirp } from 'mkdirp';
import { Debugger } from 'debug';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { DesktopBlobServer, terminateConnectionsInterval } from '@satellite-earth/core';
import { resolve as importMetaResolve } from 'import-meta-resolve';

import App from './app/index.js';
import { PORT, DATA_PATH, AUTH, REDIRECT_APP_URL, PUBLIC_ADDRESS } from './env.js';
import { CommunityMultiplexer } from './modules/community-multiplexer.js';
import { addListener, logger } from './logger.js';

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

// connect logger to app LogStore
addListener(({ namespace }, ...args) => {
	app.logStore.addEntry(namespace, Math.round(Date.now() / 1000), args.join(' '));
});

// attach app to websocket server
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

function getPublicRelayAddressFromRequest(req: Request) {
	let url: URL;
	if (PUBLIC_ADDRESS) {
		url = new URL(PUBLIC_ADDRESS);
	} else {
		url = new URL('/', req.protocol + '://' + req.hostname);
		url.port = String(PORT);
	}
	url.protocol = req.protocol === 'https:' ? 'wss:' : 'ws:';

	return url;
}

// if the app isn't setup redirect to the setup view
expressServer.get('/', (req, res, next) => {
	if (!app.config.data.owner) {
		logger('Redirecting to setup view');

		const url = new URL('/setup', REDIRECT_APP_URL || req.protocol + '://' + req.headers['host']);
		const relay = getPublicRelayAddressFromRequest(req);
		url.searchParams.set('relay', relay.toString());
		url.searchParams.set('auth', AUTH);
		res.redirect(url.toString());
	} else return next();
});

if (REDIRECT_APP_URL) {
	expressServer.get('*', (req, res) => {
		// redirect to other web ui
		const url = new URL('/connect', REDIRECT_APP_URL);
		const relay = getPublicRelayAddressFromRequest(req);
		url.searchParams.set('relay', relay.toString());

		res.redirect(url.toString());
	});
} else {
	// serve the web ui
	const appDir = path.dirname(importMetaResolve('@satellite-earth/web-ui', import.meta.url).replace('file://', ''));
	expressServer.use(express.static(appDir));
	expressServer.get('*', (req, res) => {
		res.sendFile(path.resolve(appDir, 'index.html'));
	});
}

server.on('request', expressServer);

app.start();

// Listen for http connections
server.listen(PORT, () => {
	logger(`server running on`, PORT);
	console.info('AUTH', AUTH);

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

process.on('unhandledRejection', (reason, promise) => {
	if (reason instanceof Error) {
		console.log('Unhandled Rejection');
		console.log(reason);
	} else console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});
