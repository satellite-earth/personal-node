import dayjs from 'dayjs';
import { EventEmitter } from 'events';
import { NostrEvent } from 'nostr-tools';
import { Debugger } from 'debug';
import { AbstractRelay, Subscription } from 'nostr-tools/abstract-relay';

import { logger } from '../../logger.js';

const DEFAULT_LIMIT = 1000;

export type PubkeyRelayScrapperState = {
	cursor?: number;
};

type EventMap = {
	event: [NostrEvent];
	chunk: [{ count: number; cursor: number }];
};

export default class PubkeyRelayScrapper extends EventEmitter<EventMap> {
	pubkey: string;
	relay: AbstractRelay;
	log: Debugger;

	running = false;
	complete = false;
	error?: Error;
	state: PubkeyRelayScrapperState = {};

	get cursor() {
		return this.state.cursor || dayjs().unix();
	}
	set cursor(v: number) {
		this.state.cursor = v;
	}

	private subscription?: Subscription;

	constructor(pubkey: string, relay: AbstractRelay, state?: PubkeyRelayScrapperState) {
		super();

		this.pubkey = pubkey;
		this.relay = relay;
		if (state) this.state = state;

		this.log = logger.extend('scrapper:' + pubkey + ':' + relay.url);
	}

	async loadNext() {
		// don't run if its already running, complete, or has an error
		if (this.running || this.complete || this.error) return;

		this.running = true;

		// wait for relay connection
		await this.relay.connect();

		const cursor = this.state.cursor || dayjs().unix();
		this.log(`Requesting events from ${cursor} ${dayjs.unix(cursor).format('lll')}`);

		let count = 0;
		let newCursor = cursor;
		this.subscription = this.relay.subscribe([{ authors: [this.pubkey], until: cursor, limit: DEFAULT_LIMIT }], {
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
					this.log(`Got ${count} events and moved cursor to ${newCursor} ${dayjs.unix(newCursor).format('lll')}`);
				}

				this.state.cursor = newCursor;
				this.emit('chunk', { count, cursor: this.cursor });
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
