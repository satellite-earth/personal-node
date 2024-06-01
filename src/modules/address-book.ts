import { IEventStore } from '@satellite-earth/core';
import { Filter, NostrEvent, SimplePool, kinds } from 'nostr-tools';
import _throttle from 'lodash.throttle';

import createDefer, { Deferred } from '../helpers/deferred.js';
import { COMMON_CONTACT_RELAY } from '../const.js';
import { logger } from '../logger.js';

export default class AddressBook {
	log = logger.extend('AddressBook');
	pool: SimplePool;
	eventStore: IEventStore;
	extraRelays = [COMMON_CONTACT_RELAY];

	constructor(eventStore: IEventStore, pool?: SimplePool) {
		this.eventStore = eventStore;
		this.pool = pool || new SimplePool();
	}

	private cache = new Map<string, NostrEvent>();
	getMailboxes(pubkey: string) {
		if (this.cache.has(pubkey)) return this.cache.get(pubkey)!;

		const event = this.eventStore.getEventsForFilters([{ kinds: [kinds.RelayList], authors: [pubkey] }])?.[0];
		if (event) {
			this.cache.set(pubkey, event);
			return event;
		}
	}

	handleEvent(event: NostrEvent) {
		if (event.kind === kinds.RelayList) {
			this.eventStore.addEvent(event);
			const current = this.cache.get(event.pubkey);
			if (!current || event.created_at > current.created_at) this.cache.set(event.pubkey, event);
		}
	}

	/** next queue */
	private next = new Map<string, string[]>();
	/** currently fetching */
	private fetching = new Map<string, string[]>();
	/** promises for next and fetching */
	private pending = new Map<string, Deferred<NostrEvent | null>>();

	private fetchEventsThrottle = _throttle(this.fetchEvents.bind(this), 1000);
	private async fetchEvents() {
		if (this.fetching.size > 0 || this.next.size === 0) return;

		for (const [pubkey, relays] of this.next) this.fetching.set(pubkey, relays);
		this.next.clear();

		if (this.fetching.size > 0) {
			this.log(`Looking for ${this.fetching.size} pubkeys mailboxes`);
			const filters: Record<string, Filter> = {};

			const addPubkeyToRelayFilter = (relay: string, pubkey: string) => {
				filters[relay] = filters[relay] || { kinds: [kinds.RelayList], authors: [] };

				if (!filters[relay].authors?.includes(pubkey)) {
					filters[relay].authors?.push(pubkey);
				}
			};

			for (const [pubkey, relays] of this.fetching) {
				for (const relay of this.extraRelays) {
					addPubkeyToRelayFilter(relay, pubkey);
				}
				for (const relay of relays) {
					addPubkeyToRelayFilter(relay, pubkey);
				}
			}

			const requests: Record<string, Filter[]> = {};
			for (const [relay, filter] of Object.entries(filters)) requests[relay] = [filter];

			return new Promise<void>((res) => {
				const sub = this.pool.subscribeManyMap(requests, {
					onevent: (event) => this.handleEvent(event),
					oneose: () => {
						sub.close();

						// resolve all pending promises
						let failed = 0;
						for (const [pubkey] of this.fetching) {
							const p = this.pending.get(pubkey);
							if (p) {
								const event = this.getMailboxes(pubkey) ?? null;
								p.resolve(event);
								if (!event) failed++;
								this.pending.delete(pubkey);
							}
						}
						this.fetching.clear();

						if (failed) this.log(`Failed to find mailboxes for ${failed} pubkeys`);

						res();
					},
				});
			});
		}
	}

	async loadMailboxes(pubkey: string, relays: string[] = []) {
		const event = this.getMailboxes(pubkey);
		if (event) return event;

		const pending = this.pending.get(pubkey);
		if (pending) return pending;

		const defer = createDefer<NostrEvent | null>();
		this.next.set(pubkey, this.next.get(pubkey)?.concat(relays) ?? relays);
		this.pending.set(pubkey, defer);
		this.fetchEventsThrottle();
		return defer;
	}
}
