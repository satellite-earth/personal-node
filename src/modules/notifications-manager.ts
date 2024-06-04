import { IEventStore } from '@satellite-earth/core';
import { NotificationType, WebSubscription } from '@satellite-earth/core/types/control-api/notifications.js';
import { NostrEvent, kinds } from 'nostr-tools';
import { getDMRecipient } from '@satellite-earth/core/helpers/nostr';
import dayjs from 'dayjs';
import webPush from 'web-push';

import AppState from './app-state.js';
import { logger } from '../logger.js';

export default class NotificationsManager {
	log = logger.extend('NotificationsManager');
	lastRead: number = dayjs().unix();

	owner?: string;
	state: AppState;
	keys: webPush.VapidKeys = webPush.generateVAPIDKeys();

	get subscriptions() {
		return this.state.data.subscriptions;
	}
	set subscriptions(v) {
		this.state.data.subscriptions = v;
	}

	eventStore: IEventStore;
	constructor(eventStore: IEventStore, state: AppState) {
		this.eventStore = eventStore;
		this.state = state;

		this.eventStore.on('event:inserted', this.handleEvent.bind(this));
	}

	registerSubscription(sub: WebSubscription) {
		const key = sub.keys.p256dh;
		if (this.subscriptions.some((s) => s.keys.p256dh === key)) return;

		this.log(`Added new subscription ${key}`);
		this.subscriptions = [...this.subscriptions, sub];
	}
	unregisterSubscription(key: string) {
		this.log(`Removed new subscription ${key}`);
		this.subscriptions = this.subscriptions.filter((s) => s.keys.p256dh !== key);
	}

	handleEvent(event: NostrEvent) {
		if (event.kind !== kinds.EncryptedDirectMessage) return;
		if (getDMRecipient(event) !== this.owner) return;

		if (event.created_at > this.lastRead) {
			// TODO: this should be retrieved from a ProfileManager class
			const profile = this.eventStore.getEventsForFilters([{ kinds: [0], authors: [event.pubkey] }])?.[0];

			this.notify({ sender: profile, event });
		}
	}

	async notify(notification: NotificationType) {
		this.log(`Sending notification to ${this.subscriptions.length} subscriptions`);
		for (const sub of this.subscriptions) {
			try {
				await webPush.sendNotification(sub, JSON.stringify(notification), {
					vapidDetails: {
						subject: 'mailto:admin@example.com',
						publicKey: this.keys.publicKey,
						privateKey: this.keys.privateKey,
					},
				});
			} catch (error) {
				this.log(`Failed to send push notification, removing subscription`);
				this.log(error);

				this.unregisterSubscription(sub.keys.p256dh);
			}
		}
	}
}
