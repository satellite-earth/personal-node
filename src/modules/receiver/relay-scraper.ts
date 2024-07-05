import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { NostrEvent, verifyEvent } from 'nostr-tools';
import { WebSocket } from 'ws';
import { Debugger } from 'debug';

import { logger } from '../../logger.js';

function safeVerify(event: NostrEvent) {
	try {
		return verifyEvent(event);
	} catch (error) {}
	return false;
}

export type RelayOptions = {
	skipVerification?: boolean;
};

export class RelayScraper extends EventEmitter {
	log: Debugger;
	url: string;
	ws?: WebSocket;
	connected = false;
	seen: Set<string>;
	authors: string[];
	until: number = Infinity;
	since: number = 0;
	eose = false;
	tail = false;
	subid = randomUUID();
	options: RelayOptions;

	TOLERANCE_SECONDS = 600;

	constructor(url: string, authors: string[], seen: Set<string>, options: RelayOptions = {}) {
		super();
		this.log = logger.extend(url);
		this.url = url;
		this.seen = seen;
		this.authors = authors;
		this.options = options;
	}

	connect() {
		try {
			this.ws = new WebSocket(this.url);
		} catch (err) {
			this.log('failed to open ws connection to ' + this.url);
			return;
		}

		if (!this.ws) {
			this.log('Failed to create ws');
			return;
		}

		this.ws.on('open', () => {
			this.log(this.url + ' connected');
			this.connected = true;
			this.emit('connect', this);
			this.subscribe();
		});

		this.ws.on('error', (err) => {
			this.log(this.url + ' errored: ' + err.message);
		});

		this.ws.on('close', () => {
			this.connected = false;
			if (this.connected) {
				this.connected = false;
				this.emit('disconnect', this);
			}
		});

		this.ws.onmessage = (message) => {
			let data;

			try {
				if (typeof message.data === 'string') {
					data = JSON.parse(message.data);
				}

				if (!data) return;

				if (data[0] === 'EVENT') {
					const event = data[2];
					this.eose = false;

					if (!this.tail && event.created_at < this.until) {
						this.until = event.created_at - 1;
					}

					if (event.created_at > this.since) {
						this.since = event.created_at;
					}

					if (this.seen.has(event.id)) return;

					if (this.options.skipVerification || safeVerify(event)) {
						this.seen.add(event.id);
						this.emit('event', event);
					}
				} else if (data[0] === 'EOSE') {
					this.emit('eose');

					if (this.tail) return;

					if (this.eose) {
						//console.log(`reached end of archived events, ${this.url} subscribing to tail...`);
						this.until = Infinity;
						this.tail = true;
						this.subscribe();
					} else {
						//console.log('should resubscribe to get more events');
						this.eose = true;
						this.subscribe();
					}
				} else if (data[0] === 'CLOSED') {
					this.emit('disconnect', this);
				}
			} catch (err) {
				this.log(err);
			}
		};
	}

	disconnect() {
		// TODO Set up reconnect logic to maintain subscriptions with exponential backoff

		if (this.ws) {
			try {
				this.ws.close();
				this.emit('disconnect', this);
			} catch (err) {
				this.log(err);
			}
		}
	}

	subscribe() {
		//console.log(`subscribing to ${this.url}, tail = ${this.tail}, since = ${this.since}, until = ${this.until}`);
		this.send([
			'REQ',
			this.subid,
			{
				authors: this.authors,
				since: this.since > this.TOLERANCE_SECONDS ? this.since - this.TOLERANCE_SECONDS : undefined,
				until: isFinite(this.until) ? this.until : undefined,
			},
		]);
	}

	unsubscribe() {
		if (!this.connected || !this.subid) {
			return;
		}
		this.send(['CLOSE', this.subid]);
	}

	private send(data: any) {
		try {
			if (this.ws) this.ws.send(JSON.stringify(data));
		} catch (err) {
			this.log('send error', err);
		}
	}
}
