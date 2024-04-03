import 'dotenv/config.js';
import WebSocket, { WebSocketServer } from 'ws';

import Http from './http/index.js';
import App from './app/index.js';
import { PORT, DATA_PATH, AUTH, HTTP_PORT } from './env.js';

// Needed for nostr-tools relay lib
global.WebSocket = WebSocket;

// Create websocket server
const wss = new WebSocketServer({
	port: PORT,
});

const app = new App({
	path: DATA_PATH,
	auth: AUTH,
});

// Attach http routes
const httpServer = Http(app);

// Fix CORS for websocket
wss.on('headers', (headers, request) => {
	headers.push('Access-Control-Allow-Origin: *');
});

// Setup handlers for new connections
wss.on('connection', (ws, req) => {
	// Handle new connection
	const conn = app.relay.connect(ws, req);

	if (!conn) {
		return;
	}

	ws.on('message', (buffer) => {
		app.relay.message(buffer, conn);
	});

	ws.on('close', () => {
		app.relay.disconnect(ws);
	});
});

// Allow parent (if any) to tell the node to shut itself
// down gracefully instead of just killing the process
process.on('SIGINT', () => {
	console.log('instance got SIGINT');
	app.stop();
	process.exit(0);
});

app.start();

// Listen for http connections
httpServer.listen(HTTP_PORT, () => {
	console.log(`http server running on`, HTTP_PORT);
});
