import EventEmitter from 'events';
import { Filter, NostrEvent, SimplePool } from 'nostr-tools';

import type Graph from '../graph/index.js';
import { type Node } from '../graph/index.js';
import { RelayScraper } from './relay-scraper.js';
import { logger } from '../../logger.js';

export type ReceiverStatus = {
	active: boolean;
	relays: Record<
		string,
		{
			connected: boolean;
		}
	>;
};

type EventMap = {
	started: [Receiver];
	stopped: [Receiver];
	'event:received': [NostrEvent];
	'status:changed': [ReceiverStatus];
};

export default class Receiver extends EventEmitter<EventMap> {
	log = logger.extend('Receiver');

	graph: Graph;
	pool: SimplePool;

	/** The pubkeys to start download events for */
	pubkeys = new Set<string>();
	/** always request event from these relays */
	explicitRelays = new Set<string>();
	/** The cache level for the pubkeys */
	cacheLevel = 2;

	status: ReceiverStatus = { active: false, relays: {} };
	scrapers = new Map<string, RelayScraper>();

	seen = new Set<string>();
	remote: Record<
		string,
		{ relay: RelayScraper; reconnecting?: NodeJS.Timeout; reconnectDelay: number; lastReconnectAttempt: number }
	> = {};

	constructor(pool: SimplePool, graph: Graph) {
		super();
		this.pool = pool;
		this.graph = graph;
	}

	start() {
		if (this.status.active) return;
		this.log('started', this.pubkeys, this.explicitRelays, this.cacheLevel);

		this.status.active = true;

		for (let url of Object.keys(this.remote)) {
			// @ts-expect-error
			if (!params[url]) {
				delete this.remote[url];
			}
		}

		// References needed to fetch events the user
		// might care about according to `a` tag
		const parameterizedReplaceableRefs = new Set<string>();

		// Filter and list of nodes by degrees of
		// separation and map to authors array,
		// truncated to avoid relays dropping req
		const filterNodes = (items: Node[], z: number) => {
			return items
				.filter((item) => item.z === z)
				.slice(0, 1000)
				.map((item) => item.p);
		};

		// Maybe pass received data to handler as event
		const handleEvent = (event: NostrEvent) => {
			if (this.seen.has(event.id)) {
				return;
			}

			this.seen.add(event.id);

			// Detect reference to any parameterized replaceable
			// events that a user has created to be used later
			if (event.kind >= 30000 && event.kind < 40000) {
				let relevant;

				if (this.pubkeys.has(event.pubkey)) {
					relevant = true;
				} else if (event.kind === 34550) {
					/*
					Communities are considered relevant refs
					if root pubkey is owner or moderator
					*/

					for (let tag of event.tags) {
						if (tag[0] === 'p' && this.pubkeys.has(tag[1])) {
							relevant = true; // Root user is mod
							break;
						}
					}
				}

				if (relevant) {
					let d;

					for (let tag of event.tags) {
						if (tag[0] === 'd') {
							d = tag[1];
							break;
						}
					}

					if (d) {
						parameterizedReplaceableRefs.add(`${event.kind}:${event.pubkey}:${d}`);
					}
				}
			}

			this.graph.add(event);

			this.emit('event:received', event);
		};

		// Handle closed connection to relay
		const handleDisconnect = (relay: RelayScraper) => {
			// TODO: relay should be in control of "status" object
			this.status.relays[relay.url] = { connected: false };
			this.emit('status:changed', this.status);

			if (this.remote[relay.url]) {
				clearTimeout(this.remote[relay.url].reconnecting);

				// If relay disconnected unexpectedly, automatically
				// attempt reconnect with exponential backoff
				if (this.status.active) {
					this.remote[relay.url].reconnecting = setTimeout(() => {
						console.log(
							relay.url + ' attmepting reconnect after ' + this.remote[relay.url].reconnectDelay + ' millsecs',
						);

						relay.connect();
					}, this.remote[relay.url].reconnectDelay);

					this.remote[relay.url].reconnectDelay = this.remote[relay.url].reconnectDelay * 2;
				}
			}
		};

		const handleConnect = (relay: RelayScraper) => {
			// On successful connect, reset reconnect state
			if (this.remote[relay.url]) {
				clearTimeout(this.remote[relay.url].reconnecting);
				this.remote[relay.url].reconnectDelay = 500;
			}

			// TODO: relay should be in control of "status" object
			this.status.relays[relay.url] = { connected: true };
			this.emit('status:changed', this.status);

			const primaryReference = () => {
				const primaryReferenceFilters: Filter[] = [
					{
						// DM's for you
						'#p': Array.from(this.pubkeys),
						kinds: [4],
					},
					{
						// Text notes, reposts, likes, zaps for you
						'#p': Array.from(this.pubkeys),
						kinds: [1, 6, 7, 16, 9735],
					},
					{
						// Text notes from people your following following
						authors: filterNodes(this.graph.getNodes(Array.from(this.pubkeys)), 2),
						kinds: [1],
					},
				];

				const primaryReferenceATags = Array.from(parameterizedReplaceableRefs);

				if (primaryReferenceATags.length > 0) {
					primaryReferenceFilters.push({
						'#a': primaryReferenceATags,
					});
				}

				// Primary reference
				relay.subscribe(primaryReferenceFilters, {
					oneose: () => {
						console.log(relay.url + ' primary reference got eose . . . reached the end');
					},
				});
			};

			const secondaryData = () => {
				// Secondary data
				relay.subscribe(
					[
						{
							authors: filterNodes(this.graph.getNodes(Array.from(this.pubkeys)), 1),
						},
					],
					{
						oneose: this.cacheLevel > 2 ? primaryReference : undefined,
					},
				);
			};

			const primaryData = () => {
				// Primary data
				relay.subscribe(
					[
						{
							authors: Array.from(this.pubkeys),
						},
					],
					{
						oneose: this.cacheLevel > 1 ? secondaryData : undefined,
					},
				);
			};

			const tertiaryMetadata = () => {
				// Tertiary metadata
				relay.subscribe(
					[
						{
							authors: filterNodes(this.graph.getNodes(Array.from(this.pubkeys)), 2),
							kinds: [0],
						},
					],
					{
						oneose: primaryData,
					},
				);
			};

			const secondaryMetadata = () => {
				const following = filterNodes(this.graph.getNodes(Array.from(this.pubkeys)), 1);

				// Secondary metadata
				relay.subscribe(
					[
						{
							authors: following,
							kinds: [0, 3],
						},
					],
					{
						oneose: this.cacheLevel > 2 ? tertiaryMetadata : secondaryData,
					},
				);
			};

			// Primary metadata
			relay.subscribe(
				[
					{
						authors: Array.from(this.pubkeys),
						kinds: [0, 3],
					},
				],
				{
					oneose: this.cacheLevel === 1 ? primaryData : secondaryMetadata,
				},
			);
		};

		// Connect to each relay and set up subscriptions
		for (let url of this.explicitRelays) {
			const relay = new RelayScraper(url, this.seen, {
				skipVerification: false,
			});

			this.remote[url] = {
				lastReconnectAttempt: 0,
				reconnectDelay: 500,
				relay,
			};

			relay.on('disconnect', handleDisconnect);
			relay.on('connect', handleConnect);
			relay.on('event', handleEvent);

			relay.connect();
		}

		this.emit('status:changed', this.status);
		this.emit('started', this);
	}

	/** stop receiving events and disconnect from all relays */
	stop() {
		if (!this.status.active) return;

		this.status.active = false;

		for (let key of Object.keys(this.remote)) {
			clearTimeout(this.remote[key].reconnecting);

			this.remote[key].relay.unsubscribeAll();
			this.remote[key].relay.disconnect();
			this.remote[key].relay.removeAllListeners();
		}

		this.remote = {};
		this.emit('status:changed', this.status);
		this.emit('stopped', this);
	}

	destroy() {
		this.stop();

		this.removeAllListeners();
	}
}
