import { type Database } from 'better-sqlite3';
import { WebSocket, WebSocketServer } from 'ws';
import { NostrRelay } from '../../../core/dist/index.js';

import { LabeledEventStore } from './labeled-event-store.js';
import { IncomingMessage } from 'http';

export class CommunityMultiplexer {
	db: Database;

	eventStores = new Map<string, LabeledEventStore>();
	relays = new Map<string, NostrRelay>();

	constructor(db: Database) {
		this.db = db;
	}

	attachToServer(wss: WebSocketServer) {
		wss.on('connection', this.handleConnection.bind(this));
	}

	handleConnection(ws: WebSocket, req: IncomingMessage) {
		if (!req.url) return false;

		const url = new URL(req.url, `http://${req.headers.host}`);

		const id = url.pathname.split('/')[1];

		const relay = this.relays.get(id);
		if (relay) {
			// connect the socket to the relay
			relay.handleConnection(ws, req);
			ws.on('close', () => relay.handleDisconnect(ws));

			return true;
		}

		return false;
	}

	connectToCommunity(id: string) {
		const eventStore = new LabeledEventStore(this.db, id);
		const relay = new NostrRelay(eventStore);

		this.eventStores.set(id, eventStore);
		this.relays.set(id, relay);
	}

	removeCommunity(id: string) {
		if (this.relays.has(id)) {
			this.relays.get(id)?.stop();
		}
		if (this.eventStores.has(id)) {
			this.eventStores.delete(id);
		}
	}
}
