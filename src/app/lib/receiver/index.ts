import EventEmitter from 'events';
import { Filter, NostrEvent } from 'nostr-tools';

import type Graph from '../graph/index.js';
import { type Node } from '../graph/index.js';
import { Relay } from './relay.js';

type EventMap = {
	'event:received': [NostrEvent];
	'relay:status': [{ status: 'connected' | 'disconnected'; relay: Relay }];
};

export default class Receiver extends EventEmitter<EventMap> {
	graph: Graph;

	listening = false;
	seen = new Set<string>();

	remote: Record<
		string,
		{ relay: Relay; reconnecting?: NodeJS.Timeout; reconnectDelay: number; lastReconnectAttempt: number }
	> = {};

	constructor(graph: Graph) {
		super();
		this.graph = graph;
	}

	listen(params: { pubkeys: string[]; cacheLevel: 1 | 2 | 3; relays: { url: string }[] }) {
		console.log('called listen in receiver instance', params);

		this.listening = true;

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

				if (params.pubkeys.indexOf(event.pubkey) !== -1) {
					relevant = true;
				} else if (event.kind === 34550) {
					/*
					Communities are considered relevant refs
					if root pubkey is owner or moderator
					*/

					for (let tag of event.tags) {
						if (tag[0] === 'p' && params.pubkeys.indexOf(tag[1]) !== -1) {
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
		const handleDisconnect = (relay: Relay) => {
			this.emit('relay:status', {
				status: 'disconnected',
				relay,
			});

			if (this.remote[relay.url]) {
				clearTimeout(this.remote[relay.url].reconnecting);

				// If relay disconnected unexpectedly, automatically
				// attempt reconnect with exponential backoff
				if (this.listening) {
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

		const handleConnect = (relay: Relay) => {
			// On successful connect, reset reconnect state
			if (this.remote[relay.url]) {
				clearTimeout(this.remote[relay.url].reconnecting);
				this.remote[relay.url].reconnectDelay = 500;
			}

			this.emit('relay:status', {
				status: 'connected',
				relay,
			});

			const primaryReference = () => {
				const primaryReferenceFilters: Filter[] = [
					{
						// DM's for you
						'#p': params.pubkeys,
						kinds: [4],
					},
					{
						// Text notes, reposts, likes, zaps for you
						'#p': params.pubkeys,
						kinds: [1, 6, 7, 16, 9735],
					},
					{
						// Text notes from people your following following
						authors: filterNodes(this.graph.getNodes(params.pubkeys), 2),
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
							authors: filterNodes(this.graph.getNodes(params.pubkeys), 1),
						},
					],
					{
						oneose: params.cacheLevel > 2 ? primaryReference : undefined,
					},
				);
			};

			const primaryData = () => {
				// Primary data
				relay.subscribe(
					[
						{
							authors: params.pubkeys,
						},
					],
					{
						oneose: params.cacheLevel > 1 ? secondaryData : undefined,
					},
				);
			};

			const tertiaryMetadata = () => {
				// Tertiary metadata
				relay.subscribe(
					[
						{
							authors: filterNodes(this.graph.getNodes(params.pubkeys), 2),
							kinds: [0],
						},
					],
					{
						oneose: primaryData,
					},
				);
			};

			const secondaryMetadata = () => {
				const following = filterNodes(this.graph.getNodes(params.pubkeys), 1);

				// Secondary metadata
				relay.subscribe(
					[
						{
							authors: following,
							kinds: [0, 3],
						},
					],
					{
						oneose: params.cacheLevel > 2 ? tertiaryMetadata : secondaryData,
					},
				);
			};

			// Primary metadata
			relay.subscribe(
				[
					{
						authors: params.pubkeys,
						kinds: [0, 3],
					},
				],
				{
					oneose: params.cacheLevel === 1 ? primaryData : secondaryMetadata,
				},
			);
		};

		// Connect to each relay and set up subscriptions
		for (let item of params.relays) {
			const relay = new Relay(item.url, this.seen, {
				skipVerification: false,
			});

			this.remote[item.url] = {
				lastReconnectAttempt: 0,
				reconnectDelay: 500,
				relay,
			};

			relay.on('disconnect', handleDisconnect);
			relay.on('connect', handleConnect);
			relay.on('event', handleEvent);

			relay.connect();
		}
	}

	unlisten() {
		this.listening = false;

		for (let key of Object.keys(this.remote)) {
			clearTimeout(this.remote[key].reconnecting);

			this.remote[key].relay.unsubscribeAll();
			this.remote[key].relay.disconnect();
			this.remote[key].relay.removeAllListeners();
		}

		this.remote = {};
	}

	stop() {
		this.unlisten();

		this.removeAllListeners();
	}
}
