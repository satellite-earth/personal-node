import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { Filter, NostrEvent, verifyEvent } from 'nostr-tools';
import { WebSocket } from 'ws';
import { Debugger } from 'debug';

import { logger } from '../../logger.js';

function safeVerify(event: NostrEvent) {
	try {
		return verifyEvent(event);
	} catch (error) {}
	return false;
}

type Subscription = {
	id: string;
	oneose?: () => void;
};

export type RelayOptions = {
	skipVerification?: boolean;
};

export class RelayScrapper extends EventEmitter {
	log: Debugger;
	url: string;
	ws?: WebSocket;

	connected = false;
	subs: Record<string, Subscription> = {};
	seen: Set<string>;

	options: RelayOptions;

	constructor(url: string, seen: Set<string>, options: RelayOptions = {}) {
		super();
		this.log = logger.extend(url);
		this.url = url;
		this.seen = seen;
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
		});

		this.ws.on('error', (err) => {
			this.log(this.url + ' errored: ' + err.message);
			//this.connected = false;
		});

		this.ws.on('close', () => {
			this.log(this.url + ' closed');

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

				if (data) {
					const sub = this.subs[data[1]];

					if (!sub) return;

					if (data[0] === 'EVENT') {
						const event = data[2];

						if (this.seen.has(event.id)) return;

						if (this.options.skipVerification || safeVerify(event)) {
							this.emit('event', event);
						}
					} else if (data[0] === 'EOSE') {
						if (sub.oneose) {
							// sub.oneose(this);
							sub.oneose();
						}
					} else if (data[0] === 'CLOSED') {
						// Clear existing subs
						this.subs = {};

						this.emit('disconnect', this);
					}
				}
			} catch (err) {
				this.log(err);
			}
		};
	}

	disconnect() {
		if (this.ws) {
			try {
				this.ws.close();

				this.emit('disconnect', this);
			} catch (err) {
				this.log(err);
			}
		}
	}

	subscribe(filters: Filter[] = [], options: Partial<Subscription> = {}) {
		if (filters.length === 0) {
			return;
		}

		const id = options.id || randomUUID();

		this.subs[id] = {
			id,
			...options,
		};

		this.send(['REQ', id, ...filters]);
	}

	unsubscribe(subId: string) {
		if (!this.connected) {
			return;
		}

		this.send(['CLOSE', subId]);
	}

	unsubscribeAll() {
		for (let subId of Object.keys(this.subs)) {
			this.unsubscribe(subId);
		}
	}

	send(data: any) {
		try {
			if (this.ws) this.ws.send(JSON.stringify(data));
		} catch (err) {
			this.log('send error', err);
		}
	}
}
