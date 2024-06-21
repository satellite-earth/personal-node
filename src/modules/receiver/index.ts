import EventEmitter from 'events';
import { Filter, NostrEvent, SimplePool } from 'nostr-tools';

//import type Graph from '../graph/index.js';
import { type Node } from '../graph/index.js';
import { RelayScraper } from './relay-scraper.js';
import { logger } from '../../logger.js';
import App from '../../app/index.js';
//import { formatPubkey } from '../../helpers/pubkey.js';

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

	app: App;
	// graph: Graph;
	// pool: SimplePool;

	/** The pubkeys to start download events for */
	//pubkeys = new Set<string>();
	/** always request event from these relays */
	//explicitRelays = new Set<string>();
	/** The cache level for the pubkeys */
	//cacheLevel = 2;

	status: ReceiverStatus = { active: false, relays: {} };
	scrapers = new Map<string, RelayScraper>();
	seen = new Set<string>();
	remote: Record<
		string,
		{ relay: RelayScraper; reconnecting?: NodeJS.Timeout; reconnectDelay: number; lastReconnectAttempt: number }
	> = {};

	constructor(app: App) {
		super();
		this.app = app;
		// this.pool = app.pool;
		// this.graph = app.graph;
	}

	// Filter and list of nodes by degrees of
	// separation and map to authors array,
	// truncated to avoid relays dropping req
	private filterNodes(items: Node[], z: number) {
		return items
			.filter((item) => item.z === z)
			.slice(0, 1000)
			.map((item) => item.p);
	}

	private handleConnect(relay: RelayScraper) {
		// On successful connect, reset reconnect state
		if (this.remote[relay.url]) {
			clearTimeout(this.remote[relay.url].reconnecting);
			this.remote[relay.url].reconnectDelay = 500;
		}

		// TODO: relay should be in control of "status" object
		this.status.relays[relay.url] = { connected: true };
		this.emit('status:changed', this.status);

		/*

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
					authors: this.filterNodes(this.app.graph.getNodes(Array.from(this.pubkeys)), 2),
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
						authors: this.filterNodes(this.app.graph.getNodes(Array.from(this.pubkeys)), 1),
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
						authors: this.filterNodes(this.app.graph.getNodes(Array.from(this.pubkeys)), 2),
						kinds: [0],
					},
				],
				{
					oneose: primaryData,
				},
			);
		};

		const secondaryMetadata = () => {
			const following = this.filterNodes(this.app.graph.getNodes(Array.from(this.pubkeys)), 1);

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
				//oneose: this.cacheLevel === 1 ? primaryData : secondaryMetadata,
			},
		);

		*/
	}

	// Maybe pass received data to handler as event
	private handleEvent(event: NostrEvent) {
		if (this.seen.has(event.id)) {
			return;
		}

		this.seen.add(event.id);
		this.app.graph.add(event);
		this.app.eventStore.addEvent(event);
		this.app.statusLog.logEvent(event);

		// NOTE: temporarily disable blob downloads
		// Pass the event to the blob downloader
		// if (event.pubkey === this.config.config.owner) {
		// 	this.blobDownloader.queueBlobsFromEventContent(event);
		// }

		// log event in status log
		//this.logInsertedEvent(event);

		//this.emit('event:received', event);
	}

	// Handle closed connection to relay
	private handleDisconnect(relay: RelayScraper) {
		// TODO: relay should be in control of "status" object
		this.status.relays[relay.url] = { connected: false };
		this.emit('status:changed', this.status);

		if (this.remote[relay.url]) {
			clearTimeout(this.remote[relay.url].reconnecting);

			// If relay disconnected unexpectedly, automatically
			// attempt reconnect with exponential backoff
			if (this.status.active) {
				this.remote[relay.url].reconnecting = setTimeout(() => {
					console.log(relay.url + ' attmepting reconnect after ' + this.remote[relay.url].reconnectDelay + ' millsecs');
					relay.connect();
				}, this.remote[relay.url].reconnectDelay);

				this.remote[relay.url].reconnectDelay = this.remote[relay.url].reconnectDelay * 2;
			}
		}
	}

	start() {
		if (this.status.active) return;
		this.log('started receiver for owner: ', this.app.config.data.owner);
		this.status.active = true;

		// TODO Start by asking the address book about the user
		// get a deduped list of all the relays of
		// all the user's contacts - then iterate across
		// the list When each relay connects, find which
		// of the user's followed pubkeys has that relay
		// in their outbox. If they have it there, we'd
		// expect their to be some notes from that user
		// there, so add that user's pubkey to the authors
		// filter

		const relays: string[] = [];

		//console.log('this.explicit relays', this.explicitRelays);

		// Connect to each relay and set up subscriptions
		for (let url of /*this.explicitRelays*/ relays) {
			const relay = new RelayScraper(url, this.seen, {
				skipVerification: false,
			});

			this.remote[url] = {
				lastReconnectAttempt: 0,
				reconnectDelay: 500,
				relay,
			};

			relay.on('disconnect', this.handleDisconnect);
			relay.on('connect', this.handleConnect);
			relay.on('event', this.handleEvent);
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
