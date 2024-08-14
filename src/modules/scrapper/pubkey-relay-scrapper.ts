import dayjs from 'dayjs';
import { EventEmitter } from 'events';
import { NostrEvent } from 'nostr-tools';
import { Debugger } from 'debug';
import { AbstractRelay, Subscription } from 'nostr-tools/abstract-relay';

import { logger } from '../../logger.js';

const DEFAULT_LIMIT = 1000;

type EventMap = {
	event: [NostrEvent];
};

export default class PubkeyRelayScrapper extends EventEmitter<EventMap> {
	pubkey: string;
	relay: AbstractRelay;
	log: Debugger;

	running = false;
	complete = false;
	cursor = dayjs().unix();
	error?: Error;

	private subscription?: Subscription;

	constructor(pubkey: string, relay: AbstractRelay) {
		super();

		this.pubkey = pubkey;
		this.relay = relay;

		this.log = logger.extend('scrapper:' + pubkey + ':' + relay.url);
	}

	async loadNext() {
		// don't run if its already running, complete, or has an error
		if (this.running || this.complete || this.error) return;

		this.running = true;

		// wait for relay connection
		await this.relay.connect();

		this.log(`Requesting events from ${this.cursor}`);

		let count = 0;
		let newCursor = this.cursor;
		this.subscription = this.relay.subscribe([{ authors: [this.pubkey], until: this.cursor, limit: DEFAULT_LIMIT }], {
			onevent: (event) => {
				this.emit('event', event);
				count++;

				newCursor = Math.min(newCursor, event.created_at);
			},
			oneose: () => {
				this.running = false;
				this.subscription?.close();

				// if no events where returned, mark complete
				if (count === 0) {
					this.complete = true;
					this.log('Failed to find any events, marking complete');
				} else {
					this.log(`Got ${count} events and moved cursor to ${newCursor} ${dayjs.unix(newCursor).format('LL')}`);
				}

				this.cursor = newCursor;
			},
			onclose: (reason) => {
				if (this.subscription?.closed === false) {
					// unexpected close
					this.log(`Unexpected close: ${reason}`);
					this.error = new Error(reason);
				}
			},
		});
	}
}
