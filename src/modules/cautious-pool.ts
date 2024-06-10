import EventEmitter from 'events';
import { SimplePool } from 'nostr-tools';
import { AbstractRelay } from 'nostr-tools/relay';
import { normalizeURL } from 'nostr-tools/utils';
import { logger } from '../logger.js';

export type TestRelay = (relay: AbstractRelay, challenge: string) => boolean;

type EventMap = {
	challenge: [AbstractRelay, string];
};

export default class CautiousPool extends SimplePool {
	log = logger.extend('CautiousPool');
	isSelf?: TestRelay;
	blacklist = new Set<string>();

	events = new EventEmitter<EventMap>();

	constructor(isSelf?: TestRelay) {
		super();

		this.isSelf = isSelf;
	}

	async ensureRelay(url: string, params?: { connectionTimeout?: number }): Promise<AbstractRelay> {
		url = normalizeURL(url);

		const parsed = new URL(url);
		if (parsed.host === 'localhost' || parsed.host === '127.0.0.1') throw new Error('Cant connect to localhost');

		if (this.blacklist.has(url)) throw new Error('Cant connect to self');

		const relay = await super.ensureRelay(url, params);
		if (this.checkRelay(relay)) throw new Error('Cant connect to self');

		relay._onauth = (challenge) => {
			this.checkRelay(relay, challenge);
		};

		return relay;
	}

	private checkRelay(relay: AbstractRelay, challenge?: string) {
		// @ts-expect-error
		challenge = challenge || relay.challenge;

		if (challenge) {
			this.events.emit('challenge', relay, challenge);

			if (this.isSelf && this.isSelf(relay, challenge)) {
				this.log(`Found ${relay.url} connects to ourselves, adding to blacklist`);
				this.blacklist.add(relay.url);
				relay.close();
				relay.connect = () => {
					throw new Error('Cant connect to self');
				};
				return true;
			}
		}

		return false;
	}
}
