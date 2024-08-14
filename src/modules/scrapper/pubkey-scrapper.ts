import App from '../../app/index.js';
import { NostrEvent } from 'nostr-tools';
import { EventEmitter } from 'events';

import { getOutboxes } from '../../helpers/mailboxes.js';
import PubkeyRelayScrapper from './pubkey-relay-scrapper.js';
import { Debugger } from 'debug';
import { logger } from '../../logger.js';

type EventMap = {
	event: [NostrEvent];
};

export default class PubkeyScrapper extends EventEmitter<EventMap> {
	app: App;
	pubkey: string;
	additionalRelays: string[] = [];
	log: Debugger;

	relayScrappers = new Map<string, PubkeyRelayScrapper>();

	constructor(app: App, pubkey: string) {
		super();
		this.app = app;
		this.pubkey = pubkey;

		this.log = logger.extend('scrapper:' + this.pubkey);
	}

	async ensureData() {
		// get mailboxes
		this.app.profileBook.loadProfile(this.pubkey);
		const mailboxes = await this.app.addressBook.loadMailboxes(this.pubkey);

		return { mailboxes };
	}

	async loadNext() {
		const { mailboxes } = await this.ensureData();

		const outboxes = getOutboxes(mailboxes);

		const relays = [...outboxes, ...this.additionalRelays];
		const scrappers: PubkeyRelayScrapper[] = [];
		for (const url of relays) {
			try {
				let scrapper = this.relayScrappers.get(url);
				if (!scrapper) {
					const relay = await this.app.pool.ensureRelay(url);
					scrapper = new PubkeyRelayScrapper(this.pubkey, relay);
					scrapper.on('event', (event) => this.emit('event', event));

					this.relayScrappers.set(url, scrapper);
				}

				scrappers.push(scrapper);
			} catch (error) {
				this.log(`Failed to create relay scrapper for ${url}`);
			}
		}

		// call loadNext on the one with the latest cursor
		const incomplete = scrappers
			.filter((s) => !s.complete && !s.running && !s.error)
			.sort((a, b) => b.cursor - a.cursor);

		const next = incomplete[0];
		if (next) await next.loadNext();
	}
}
