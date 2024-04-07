import { type Database } from 'better-sqlite3';
import { WebSocket, WebSocketServer } from 'ws';
import { type IncomingMessage } from 'http';
import debug, { Debugger } from 'debug';
import { randomBytes } from 'crypto';

import { NostrRelay } from '../../../core/dist/index.js';
import { LabeledEventStore } from './labeled-event-store.js';
import { NostrEvent, Relay, SimplePool, Subscription } from 'nostr-tools';
import { HyperConnectionManager } from './hyper-connection-manager.js';
import { logger } from '../logger.js';

class CommunityProxy {
	log: Debugger;
	db: Database;
	connectionManager: HyperConnectionManager;
	definition: NostrEvent;

	upstream?: Relay;
	eventStore: LabeledEventStore;
	relay: NostrRelay;

	upstreamSubscriptions = new Map<string, Subscription>();

	get addresses() {
		return this.definition.tags.filter((t) => t[0] === 'r' && t[1]).map((t) => t[1]);
	}

	constructor(db: Database, communityDefinition: NostrEvent, connectionManager: HyperConnectionManager) {
		this.db = db;
		this.connectionManager = connectionManager;
		this.definition = communityDefinition;
		this.log = logger.extend('community-proxy:' + communityDefinition.pubkey);

		this.eventStore = new LabeledEventStore(this.db, communityDefinition.pubkey);
		this.relay = new NostrRelay(this.eventStore);
	}

	protected async connectUpstream() {
		if (this.upstream) {
			this.upstream.close();
			this.upstream = undefined;
		}

		const hyperAddress = this.definition.tags.find((t) => t[0] === 'r' && t[1] && t[2] === 'hyper')?.[1];
		let address = this.definition.tags.find((t) => t[0] === 'r' && t[1].startsWith('ws'))?.[1];

		if (hyperAddress) {
			const serverInfo = await this.connectionManager.getLocalAddress(hyperAddress);
			address = new URL(`ws://${serverInfo.address}:${serverInfo.port}`).toString();
			this.log('Bound hyper address to', address);
		}

		if (!address) throw new Error('Failed to find connection address');

		this.log('Connecting to upstream', address);
		this.upstream = await Relay.connect(address);

		this.upstream.onclose = () => {
			this.log('Upstream connection closed');
		};
	}

	async connect() {
		await this.connectUpstream();

		this.relay.on('event:received', (event) => {
			// send event to upstream relay
			if (this.upstream) {
				this.log('Sending event to upstream', event.id);
				this.upstream.publish(event);
			}
		});
		this.relay.on('subscription:created', (subscription, ws) => {
			if (!this.upstream) return;

			// open sub to upstream relay
			this.log('Creating upstream subscription', subscription.id);
			const upstreamSubscription = this.upstream.subscribe(subscription.filters, {
				// @ts-expect-error
				id: subscription.id,
				onevent: (event) => {
					this.eventStore.addEvent(event);
				},
				onclose: () => {
					this.upstreamSubscriptions.delete(subscription.id);
				},
			});

			this.upstreamSubscriptions.set(subscription.id, upstreamSubscription);
		});
		this.relay.on('subscription:updated', (subscription, ws) => {
			if (!this.upstream) return;

			// update upstream subscription
			this.log('Updating upstream subscription', subscription.id);
			const upstreamSubscription = this.upstreamSubscriptions.get(subscription.id);
			if (upstreamSubscription) {
				upstreamSubscription.filters = subscription.filters;
				upstreamSubscription.fire();
			}
		});
		this.relay.on('subscription:closed', (subscription, ws) => {
			if (this.upstreamSubscriptions.has(subscription.id)) {
				this.log('Closing upstream subscription', subscription.id);
				this.upstreamSubscriptions.get(subscription.id)?.close();
				this.upstreamSubscriptions.delete(subscription.id);
			}
		});
	}

	stop() {
		for (const [id, sub] of this.upstreamSubscriptions) {
			sub.close();
		}
		this.upstream?.close();
	}
}

export class CommunityMultiplexer {
	log = logger.extend('community-multiplexer');
	db: Database;
	pool: SimplePool;
	connectionManager: HyperConnectionManager;

	communities = new Map<string, CommunityProxy>();

	constructor(db: Database) {
		this.db = db;
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
		// const definition = await this.pool.get(['wss://nostrue.com'], {
		// 	kinds: [12012],
		// 	authors: [pubkey],
		// });
		const definition = {
			id: '340b66d764e5290e06d4569cd24a54f58b31839a7d540f069a49bc68d4c9701c',
			pubkey: 'caa2226e843e865a54fbbf18eb785457aa869e6e73dbb91c8bdbaf0cbca36fdc',
			created_at: 1712503609,
			kind: 12012,
			tags: [['r', 'bddfc6db5d2ee2e60feb1a49b74950fe4b46c486154d74d2312142f94f91a407', 'hyper']],
			content: '',
			sig: '125d7cdb74343a229e848b2c5c1120710708920925cb3c7ddebce966a08c3ad1d4b8972621ef7cc2213cffc4817a18ef3bef5ba44c40018e56dad783bd94d267',
		};
		if (!definition) throw new Error('Failed to find community definition');

		this.log('Connecting to community', pubkey);
		const community = new CommunityProxy(this.db, definition, this.connectionManager);
		await community.connect();

		this.communities.set(pubkey, community);

		return community;
	}
}
