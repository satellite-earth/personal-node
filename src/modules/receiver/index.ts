import EventEmitter from 'events';
import { NostrEvent } from 'nostr-tools';

import { logger } from '../../logger.js';
import App from '../../app/index.js';
import { BOOTSTRAP_RELAYS, COMMON_CONTACT_RELAYS } from '../../env.js';
import { RelayScraper } from './relay-scraper.js';

export type ReceiverStatus = {
	active: boolean;
};

type EventMap = {
	started: [Receiver];
	stopped: [Receiver];
	'event:received': [NostrEvent];
	'status:changed': [ReceiverStatus];
};

export default class Receiver extends EventEmitter<EventMap> {
	log = logger.extend('Receiver');
	status: ReceiverStatus = { active: false };
	scrapers: Map<string, RelayScraper>;
	seen: Set<string>;
	app: App;

	constructor(app: App) {
		super();
		this.app = app;
		this.seen = new Set();
		this.status = { active: false };
		this.scrapers = new Map();
	}

	async start() {
		if (this.status.active) return;

		this.log('started receiver for owner: ', this.app.config.data.owner);
		this.status.active = true;

		// Start by ensuring that the owner's following list is loaded
		await this.app.contactBook.loadContacts(this.app.config.data.owner || '');

		// Load followed pubkeys, adding owner pubkey if not present
		const following = this.app.contactBook.getFollowedPubkeys(this.app.config.data.owner ?? '') ?? [];
		if (this.app.config.data.owner && !following.includes(this.app.config.data.owner)) {
			following.unshift(this.app.config.data.owner);
		}

		// Load relay list for every pubkey
		await Promise.all(
			following.map((pubkey) => {
				return this.app.addressBook.loadMailboxes(pubkey, COMMON_CONTACT_RELAYS);
			}),
		);

		const outboxMap: Record<string, string[]> = {};
		// Get the outboxes for every pubkey - if pubkey has not defined
		// any explicitly, fallback to using the bootstrap relays - build
		// a mapping of which relays are used as outbox for which pubkey(s)
		for (let pubkey of following /*[this.app.config.data.owner ?? '']*/) {
			let outboxes = this.app.addressBook.getOutboxes(pubkey) ?? [];
			for (let item of outboxes?.length > 0 ? outboxes : BOOTSTRAP_RELAYS) {
				// For each item, compare href to account for possbile trailing slash
				// and init (as necessary) list of pubkeys using this outbox relay
				const url = new URL(item);
				if (!outboxMap[url.href]) {
					outboxMap[url.href] = [];
				}
				// Add pubkey to the list using this outbox relay
				if (!outboxMap[url.href].includes(pubkey)) {
					outboxMap[url.href].push(pubkey);
				}
			}
		}

		Object.entries(outboxMap).forEach(([url, pubkeys]) => {
			const scraper = new RelayScraper(url, pubkeys, this.seen);
			this.scrapers.set(url, scraper);
			scraper.on('event', (event) => {
				// NOTE: temporarily disable blob downloads
				// Pass the event to the blob downloader
				// if (event.pubkey === this.config.config.owner) {
				// 	this.blobDownloader.queueBlobsFromEventContent(event);
				// }
				this.emit('event:received', event);
			});

			scraper.connect();
		});

		this.emit('status:changed', this.status);
		this.emit('started', this);
	}

	/** stop receiving events and disconnect from all relays */
	stop() {
		if (!this.status.active) return;

		this.status.active = false;

		// Cleanup all the relay scrapers
		Object.entries(this.scrapers).forEach(([url, scraper]) => {
			scraper.unsubscribe();
			scraper.disconnect();
			scraper.removeAllListeners();
		});

		this.emit('status:changed', this.status);
		this.emit('stopped', this);
	}

	destroy() {
		this.stop();
		this.removeAllListeners();
	}
}
