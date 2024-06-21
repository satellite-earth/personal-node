//import { IEventStore } from '@satellite-earth/core';
import { NostrEvent, kinds } from 'nostr-tools';
import { SubCloser } from 'nostr-tools/abstract-pool';
import { Subscription } from 'nostr-tools/abstract-relay';
import { EventEmitter } from 'events';

//import AddressBook from './address-book.js';
import { getInboxes } from '../helpers/mailboxes.js';
import { logger } from '../logger.js';
//import LocalDatabase from '../app/database.js';
import App from '../app/index.js';

type EventMap = {
	open: [string, string];
	close: [string, string];
};

/** handles sending and receiving direct messages */
export default class DirectMessageManager extends EventEmitter<EventMap> {
	log = logger.extend('DirectMessageManager');
	app: App;
	// database: LocalDatabase;
	// eventStore: IEventStore;
	// addressBook: AddressBook;
	// pool: SimplePool;

	private explicitRelays: string[] = [];

	constructor(
		app: App /*database: LocalDatabase, eventStore: IEventStore, addressBook?: AddressBook, pool?: SimplePool*/,
	) {
		super();
		this.app = app;
		// this.database = database;
		// this.eventStore = eventStore;
		// this.pool = pool || new SimplePool();
		// this.addressBook = addressBook || new AddressBook(eventStore, pool);

		// Load profiles for particpants when
		// a conversation thread is opened
		this.on('open', (a, b) => {
			this.app.profileBook.loadProfile(a, this.app.addressBook.getOutboxes(a));
			this.app.profileBook.loadProfile(b, this.app.addressBook.getOutboxes(b));
		});
	}

	// updateExplicitRelays(relays: string[]) {
	// 	this.explicitRelays = relays;
	// }

	/** sends a DM event to the receivers inbox relays */
	async forwardMessage(event: NostrEvent) {
		if (event.kind !== kinds.EncryptedDirectMessage) return;

		const addressedTo = event.tags.find((t) => t[0] === 'p')?.[1];
		if (!addressedTo) return;

		const mailboxes = await this.app.addressBook.loadMailboxes(addressedTo);

		const inboxes = getInboxes(mailboxes, this.explicitRelays);
		this.log(`Forwarding message to ${inboxes.length} relays`);
		const results = await Promise.allSettled(this.app.pool.publish(inboxes, event));

		return results;
	}

	private getConversationKey(a: string, b: string) {
		if (a < b) return a + ':' + b;
		else return b + ':' + a;
	}

	watching = new Map<string, Map<string, Subscription>>();
	async watchInbox(pubkey: string) {
		if (this.watching.has(pubkey)) return;

		this.log(`Watching ${pubkey} inboxes for mail`);
		const mailboxes = await this.app.addressBook.loadMailboxes(pubkey);
		if (!mailboxes) {
			this.log(`Failed to get ${pubkey} mailboxes`);
			return;
		}

		const relays = getInboxes(mailboxes, this.explicitRelays);
		const subscriptions = new Map<string, Subscription>();

		for (const url of relays) {
			const subscribe = async () => {
				const relay = await this.app.pool.ensureRelay(url);
				const sub = relay.subscribe([{ kinds: [kinds.EncryptedDirectMessage], '#p': [pubkey] }], {
					onevent: (event) => {
						this.app.eventStore.addEvent(event);
					},
					onclose: () => {
						// reconnect if we are still watching this pubkey
						if (this.watching.has(pubkey)) {
							this.log(`Reconnecting to ${relay.url} for ${pubkey} inbox DMs`);
							setTimeout(() => subscribe(), 30_000);
						}
					},
				});

				subscriptions.set(relay.url, sub);
			};

			subscribe();
		}
		this.watching.set(pubkey, subscriptions);
	}
	stopWatchInbox(pubkey: string) {
		const subs = this.watching.get(pubkey);
		if (subs) {
			this.watching.delete(pubkey);
			for (const [_, sub] of subs) {
				sub.close();
			}
		}
	}

	subscriptions = new Map<string, SubCloser>();
	async openConversation(a: string, b: string) {
		const key = this.getConversationKey(a, b);

		if (this.subscriptions.has(key)) return;

		const aMailboxes = await this.app.addressBook.loadMailboxes(a);
		const bMailboxes = await this.app.addressBook.loadMailboxes(b);

		// If inboxes for either user cannot be determined, either because nip65
		// was not found, or nip65 had no listed read relays, fall back to explicit
		const aInboxes = aMailboxes ? getInboxes(aMailboxes, this.explicitRelays) : this.explicitRelays;
		const bInboxes = bMailboxes ? getInboxes(bMailboxes, this.explicitRelays) : this.explicitRelays;

		const relays = new Set([...aInboxes, ...bInboxes]);

		let events = 0;
		const sub = this.app.pool.subscribeMany(
			Array.from(relays),
			[{ kinds: [kinds.EncryptedDirectMessage], authors: [a, b], '#p': [a, b] }],
			{
				onevent: (event) => {
					events += +this.app.eventStore.addEvent(event);
				},
				oneose: () => {
					if (events) this.log(`Found ${events} new messages`);
				},
			},
		);

		this.log(`Opened conversation ${key} on ${relays.size} relays`);
		this.subscriptions.set(key, sub);
		this.emit('open', a, b);
	}
	closeConversation(a: string, b: string) {
		const key = this.getConversationKey(a, b);

		const sub = this.subscriptions.get(key);
		if (sub) {
			sub.close();
			this.subscriptions.delete(key);
			this.emit('close', a, b);
		}
	}

	getKind4MessageCount(pubkey: string) {
		return this.app.database.getKind4MessageCount(pubkey);
	}
}
