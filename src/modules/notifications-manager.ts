import { IEventStore } from '@satellite-earth/core';
import { NotificationType, WebSubscription } from '@satellite-earth/core/types/control-api/notifications.js';
import { NostrEvent, kinds } from 'nostr-tools';
import dayjs from 'dayjs';
import webPush from 'web-push';

import AppState from './app-state.js';

export default class NotificationsManager {
	lastRead: number = dayjs().unix();
	state: AppState;
	keys: webPush.VapidKeys = webPush.generateVAPIDKeys();

	eventStore: IEventStore;
	constructor(eventStore: IEventStore, state: AppState) {
		this.eventStore = eventStore;
		this.state = state;

		this.eventStore.on('event:inserted', this.handleEvent.bind(this));
	}

	registerSubscription(sub: WebSubscription) {
		this.state.data.subscriptions = [...this.state.data.subscriptions, sub];
	}
	unregisterSubscription(id: string) {
		this.state.data.subscriptions = this.state.data.subscriptions.filter((s) => s.id !== id);
	}

	handleEvent(event: NostrEvent) {
		if (event.kind !== kinds.EncryptedDirectMessage) return;
		if (event.created_at > this.lastRead) {
			// TODO: this should be retrieved from a ProfileManager class
			const profile = this.eventStore.getEventsForFilters([{ kinds: [0], authors: [event.pubkey] }])?.[0];

			this.notify({ sender: profile, event });
		}
	}

	async notify(notification: NotificationType) {
		for (const sub of this.state.data.subscriptions) {
			await webPush.sendNotification(sub, JSON.stringify(notification));
		}
	}
}
