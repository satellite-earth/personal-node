import SuperMap from '@satellite-earth/core/helpers/super-map.js';
import { EventEmitter } from 'events';

import App from '../../app/index.js';
import { logger } from '../../logger.js';
import { getPubkeysFromList } from '@satellite-earth/core/helpers/nostr/lists.js';
import PubkeyScrapper from './pubkey-scrapper.js';
import { NostrEvent } from 'nostr-tools';

type EventMap = {
	event: [NostrEvent];
};

export default class Scrapper extends EventEmitter<EventMap> {
	app: App;
	log = logger.extend('scrapper:service');

	// pubkey -> relay -> scrapper
	scrappers = new SuperMap<string, PubkeyScrapper>((pubkey) => {
		const scrapper = new PubkeyScrapper(this.app, pubkey);
		scrapper.on('event', (event) => this.emit('event', event));
		return scrapper;
	});

	constructor(app: App) {
		super();
		this.app = app;
	}

	async ensureData() {
		if (!this.app.config.data.owner) throw new Error('Owner not setup yet');

		// get mailboxes and contacts
		const mailboxes = await this.app.addressBook.loadMailboxes(this.app.config.data.owner);
		const contacts = await this.app.contactBook.loadContacts(this.app.config.data.owner);

		if (!contacts) throw new Error('Missing contact list');

		return { contacts: getPubkeysFromList(contacts), mailboxes };
	}

	async *createBatch() {
		if (!this.app.config.data.owner) throw new Error('Owner not setup yet');

		const { contacts } = await this.ensureData();

		this.log(`Scrapping next chunk for owner`);
		const scrapper = this.scrappers.get(this.app.config.data.owner);
		yield await scrapper.loadNext();

		this.log(`Scrapping next chunk for all contacts`);
		for (const person of contacts) {
			const scrapper = this.scrappers.get(person.pubkey);
			if (person.relay) scrapper.additionalRelays = [person.relay];

			yield await scrapper.loadNext();
		}
	}

	private currentBatch?: AsyncGenerator;
	async loadNext() {
		if (!this.currentBatch) this.currentBatch = this.createBatch();

		const { done } = await this.currentBatch.next();
		if (done) this.currentBatch = undefined;
	}
}
