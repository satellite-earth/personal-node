import { IEventStore } from '@satellite-earth/core';
import { NostrEvent, SimplePool, kinds } from 'nostr-tools';
import { SubCloser } from 'nostr-tools/abstract-pool';

import AddressBook from './address-book.js';
import { getInboxes } from '../helpers/mailboxes.js';
import { logger } from '../logger.js';

/** handles sending and receiving direct messages */
export default class DirectMessageManager {
	log = logger.extend('DirectMessageManager');
	eventStore: IEventStore;
	addressBook: AddressBook;
	pool: SimplePool;

	constructor(eventStore: IEventStore, addressBook?: AddressBook, pool?: SimplePool) {
		this.eventStore = eventStore;
		this.pool = pool || new SimplePool();
		this.addressBook = addressBook || new AddressBook(eventStore, pool);
	}

	/** sends a DM event to the receivers inbox relays */
	async forwardMessage(event: NostrEvent) {
		if (event.kind !== kinds.EncryptedDirectMessage) return;

		const addressedTo = event.tags.find((t) => t[0] === 'p')?.[1];
		if (!addressedTo) return;

		const mailboxes = await this.addressBook.loadMailboxes(event.pubkey);
		if (!mailboxes) return;

		const inboxes = getInboxes(mailboxes);
		this.log(`Forwarding message to ${inboxes.length} relays`);
		const results = await Promise.allSettled(this.pool.publish(inboxes, event));

		return results;
	}

	private getConversationKey(a: string, b: string) {
		if (a < b) return a + ':' + b;
		else return b + ':' + a;
	}

	watching = new Map<string, SubCloser>();
	async watchInbox(pubkey: string) {
		if (this.watching.has(pubkey)) return;

		this.log(`Watching ${pubkey} inboxes for mail`);
		const mailboxes = await this.addressBook.loadMailboxes(pubkey);
		if (!mailboxes) {
			this.log(`Failed to get ${pubkey} mailboxes`);
			return;
		}

		const inboxes = getInboxes(mailboxes);
		const sub = this.pool.subscribeMany(inboxes, [{ kinds: [kinds.EncryptedDirectMessage], '#p': [pubkey] }], {
			onevent: (event) => {
				this.eventStore.addEvent(event);
			},
		});
		this.watching.set(pubkey, sub);
	}
	stopWatchInbox(pubkey: string) {
		const sub = this.watching.get(pubkey);
		if (sub) {
			this.watching.delete(pubkey);
			sub.close();
		}
	}

	subscriptions = new Map<string, SubCloser>();
	async openConversation(a: string, b: string) {
		const key = this.getConversationKey(a, b);

		if (this.subscriptions.has(key)) return;

		const aMailboxes = await this.addressBook.loadMailboxes(a);
		const bMailboxes = await this.addressBook.loadMailboxes(b);

		const aInboxes = aMailboxes ? getInboxes(aMailboxes) : [];
		const bInboxes = bMailboxes ? getInboxes(bMailboxes) : [];

		const relays = new Set([...aInboxes, ...bInboxes]);

		let events = 0;
		const sub = this.pool.subscribeMany(
			Array.from(relays),
			[{ kinds: [kinds.EncryptedDirectMessage], authors: [a, b], '#p': [a, b] }],
			{
				onevent: (event) => {
					events += +this.eventStore.addEvent(event);
				},
				oneose: () => {
					if (events) this.log(`Found ${events} new messages`);
				},
			},
		);

		this.log(`Opened conversation ${key} on ${relays.size} relays`);
		this.subscriptions.set(key, sub);
	}
	closeConversation(a: string, b: string) {
		const key = this.getConversationKey(a, b);

		const sub = this.subscriptions.get(key);
		if (sub) {
			sub.close();
			this.subscriptions.delete(key);
		}
	}
}
