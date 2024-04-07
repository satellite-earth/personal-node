import {type Database} from 'better-sqlite3'
import { WebSocket, WebSocketServer } from 'ws';
import { type IncomingMessage } from 'http';
import { randomBytes } from 'crypto';
import { NostrEvent, SimplePool } from 'nostr-tools';

import { HyperConnectionManager } from './hyper-connection-manager.js';
import { logger } from '../logger.js';
import { CommunityProxy } from './community-proxy.js';
import { SQLiteEventStore } from '../../../core/dist/index.js';

export class CommunityMultiplexer {
	log = logger.extend('community-multiplexer');
	db: Database
	eventStore: SQLiteEventStore;
	pool: SimplePool;
	connectionManager: HyperConnectionManager;

	communities = new Map<string, CommunityProxy>();

	constructor(db: Database, eventStore: SQLiteEventStore) {
		this.db = db
		this.eventStore = eventStore;
		this.pool = new SimplePool();

		this.connectionManager = new HyperConnectionManager(randomBytes(32).toString('hex'));
	}

	stop() {
		for (const [pubkey, community] of this.communities) {
			community.stop();
		}
		this.connectionManager.stop();
	}

	attachToServer(wss: WebSocketServer) {
		wss.on('connection', this.handleConnection.bind(this));
	}

	async handleConnection(ws: WebSocket, req: IncomingMessage) {
		if (!req.url) return false;

		const url = new URL(req.url, `http://${req.headers.host}`);
		const pubkey = url.pathname.split('/')[1] as string | undefined;
		if (!pubkey || pubkey.length !== 64) return false;

		try {
			let community = this.communities.get(pubkey);
			if (!community) community = await this.connectToCommunity(pubkey);

			// connect the socket to the relay
			community.relay.handleConnection(ws, req);
			return true;
		} catch (error) {
			this.log('Failed to connect to', pubkey);
			console.log(error);
			return false;
		}
	}

	async connectToCommunity(pubkey: string) {
		this.log('Looking for community definition', pubkey);
		let definition: NostrEvent | undefined = undefined;

		const local = this.eventStore.getEventsForFilters([{ kinds: [12012], authors: [pubkey] }]);
		if (local[0]) definition = local[0];

		if (!definition) {
			definition = (await this.pool.get(['wss://nostrue.com'], { kinds: [12012], authors: [pubkey] })) ?? undefined;
		}

		if (!definition) throw new Error('Failed to find community definition');

		this.log('Connecting to community', pubkey);
		const community = new CommunityProxy(this.db, definition, this.connectionManager);
		await community.connect();

		this.communities.set(pubkey, community);

		return community;
	}
}
