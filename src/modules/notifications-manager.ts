import { NotificationType, WebSubscription } from '@satellite-earth/core/types/control-api/notifications.js';
import { NostrEvent, kinds } from 'nostr-tools';
import { getDMRecipient } from '@satellite-earth/core/helpers/nostr';
import dayjs from 'dayjs';
import webPush from 'web-push';

import { logger } from '../logger.js';
import App from '../app/index.js';

export default class NotificationsManager {
	log = logger.extend('NotificationsManager');
	app: App;
	lastRead: number = dayjs().unix();

	keys: webPush.VapidKeys = webPush.generateVAPIDKeys();

	get subscriptions() {
		return this.app.state.data.subscriptions;
	}
	set subscriptions(v) {
		this.app.state.data.subscriptions = v;
	}

	constructor(app: App) {
		this.app = app;
		this.app.eventStore.on('event:inserted', this.handleEvent.bind(this));
	}

	registerSubscription(sub: WebSubscription) {
		const key = sub.keys.p256dh;
		if (this.subscriptions.some((s) => s.keys.p256dh === key)) return;

		this.log(`Added new subscription ${key}`);
		this.subscriptions = [...this.subscriptions, sub];
	}
	unregisterSubscription(key: string) {
		this.log(`Removed subscription ${key}`);
		this.subscriptions = this.subscriptions.filter((s) => s.keys.p256dh !== key);
	}

	handleEvent(event: NostrEvent) {
		if (event.kind !== kinds.EncryptedDirectMessage) return;
		if (getDMRecipient(event) !== this.app.config.data.owner) return;

		if (event.created_at > this.lastRead) {
			// TODO: this should be retrieved from a ProfileManager class
			const profile = this.app.eventStore.getEventsForFilters([{ kinds: [0], authors: [event.pubkey] }])?.[0];

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
