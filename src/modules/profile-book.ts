import { Filter, NostrEvent, kinds } from 'nostr-tools';
import _throttle from 'lodash.throttle';

import createDefer, { Deferred } from '../helpers/deferred.js';
import { COMMON_CONTACT_RELAYS } from '../env.js';
import { logger } from '../logger.js';
import App from '../app/index.js';

/** loads kind 0 metadata for pubkeys */
export default class ProfileBook {
	log = logger.extend('ProfileBook');
	app: App;
	extraRelays = COMMON_CONTACT_RELAYS;

	constructor(app: App) {
		this.app = app;
	}

	private cache = new Map<string, NostrEvent>();
	getProfile(pubkey: string) {
		if (this.cache.has(pubkey)) return this.cache.get(pubkey)!;

		const event = this.app.eventStore.getEventsForFilters([{ kinds: [kinds.Metadata], authors: [pubkey] }])?.[0];
		if (event) {
			this.cache.set(pubkey, event);
			return event;
		}
	}

	handleEvent(event: NostrEvent) {
		if (event.kind === kinds.Metadata) {
			this.app.eventStore.addEvent(event);
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
			const filters: Record<string, Filter> = {};

			const addPubkeyToRelayFilter = (relay: string, pubkey: string) => {
				filters[relay] = filters[relay] || { kinds: [kinds.Metadata], authors: [] };

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
				const sub = this.app.pool.subscribeManyMap(requests, {
					onevent: (event) => this.handleEvent(event),
					oneose: () => {
						sub.close();

						// resolve all pending promises
						let failed = 0;
						let found = 0;
						for (const [pubkey] of this.fetching) {
							const p = this.pending.get(pubkey);
							if (p) {
								const event = this.getProfile(pubkey) ?? null;
								p.resolve(event);
								if (!event) failed++;
								else found++;
								this.pending.delete(pubkey);
							}
						}
						this.fetching.clear();

						if (failed) this.log(`Found ${found}, Failed ${failed}`);

						res();
					},
				});
			});
		}
	}

	async loadProfile(pubkey: string, relays: string[] = []) {
		const event = this.getProfile(pubkey);
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
