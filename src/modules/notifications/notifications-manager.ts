import {
	NotificationSubscription,
	WebPushNotification,
} from '@satellite-earth/core/types/control-api/notifications.js';
import { NostrEvent, kinds } from 'nostr-tools';
import { getDMRecipient, getDMSender, getUserDisplayName, parseKind0Event } from '@satellite-earth/core/helpers/nostr';
import dayjs from 'dayjs';
import webPush from 'web-push';
import { npubEncode } from 'nostr-tools/nip19';

import { logger } from '../../logger.js';
import App from '../../app/index.js';

export type NotificationsManagerState = {
	subscriptions: NotificationSubscription[];
};

export default class NotificationsManager {
	log = logger.extend('Notifications');
	app: App;
	lastRead: number = dayjs().unix();

	webPushKeys: webPush.VapidKeys = webPush.generateVAPIDKeys();

	state: NotificationsManagerState = { subscriptions: [] };

	constructor(app: App) {
		this.app = app;
	}

	async setup() {
		this.state = (
			await this.app.state.getMutableState<NotificationsManagerState>('notification-manager', { subscriptions: [] })
		).proxy;
	}

	private checkDuplicate(sub: NotificationSubscription) {
		const { subscriptions } = this.state;

		switch (sub.type) {
			case 'web':
				const key = sub.keys.p256dh;
				if (subscriptions.some((s) => s.type === 'web' && s.keys.p256dh === key)) {
					return true;
				}
				break;
			case 'ntfy':
				if (subscriptions.some((s) => s.type === 'ntfy' && s.server === sub.server && s.topic === sub.topic)) {
					return true;
				}
				break;
		}

		return false;
	}

	registerSubscription(sub: NotificationSubscription) {
		if (this.checkDuplicate(sub)) return;

		this.log(`Added new subscription ${sub.id} (${sub.type})`);
		this.state.subscriptions = [...this.state.subscriptions, sub];
	}
	unregisterSubscription(id: string) {
		if (this.state.subscriptions.some((s) => s.id === id)) {
			this.log(`Removed subscription ${id}`);
			this.state.subscriptions = this.state.subscriptions.filter((s) => s.id !== id);
		}
	}

	/** Whether a notification should be sent */
	shouldNotify(event: NostrEvent) {
		if (event.kind !== kinds.EncryptedDirectMessage) return;
		if (getDMRecipient(event) !== this.app.config.data.owner) return;

		if (event.created_at > this.lastRead) return true;
	}

	/** builds a notification based on a nostr event */
	async buildNotification(event: NostrEvent) {
		// TODO in the future we might need to build special notifications for subscription type
		switch (event.kind) {
			case kinds.EncryptedDirectMessage:
				const sender = getDMSender(event);
				const senderProfileEvent = await this.app.profileBook.loadProfile(sender);
				const senderProfile = senderProfileEvent ? parseKind0Event(senderProfileEvent) : undefined;
				const senderName = getUserDisplayName(senderProfile, sender);

				return {
					kind: event.kind,
					event,
					senderName,
					senderProfile,
					title: `Message from ${senderName}`,
					body: 'Tap on notification to read',
					icon: 'https://app.satellite.earth/logo-64x64.png',
					// TODO: switch this to a satellite:// link once the native app supports it
					url: `https://app.satellite.earth/messages/p/${npubEncode(sender)}`,
				};
		}
	}

	async notify(event: NostrEvent) {
		const notification = await this.buildNotification(event);
		if (!notification) return;

		this.log(`Sending notification for ${event.id} to ${this.state.subscriptions.length} subscriptions`);

		for (const sub of this.state.subscriptions) {
			this.log(`Sending notification "${notification.title}" to ${sub.id} (${sub.type})`);
			try {
				switch (sub.type) {
					case 'web':
						const pushNotification: WebPushNotification = {
							title: notification.title,
							body: notification.body,
							icon: notification.icon,
							url: notification.url,
							event: notification.event,
						};

						await webPush.sendNotification(sub, JSON.stringify(pushNotification), {
							vapidDetails: {
								subject: 'mailto:admin@example.com',
								publicKey: this.webPushKeys.publicKey,
								privateKey: this.webPushKeys.privateKey,
							},
						});
						break;

					case 'ntfy':
						const headers: HeadersInit = {
							Title: notification.title,
							Icon: notification.icon,
							Click: notification.url,
						};

						if (this.app.config.data.notificationEmail) {
							headers['Email'] = this.app.config.data.notificationEmail;
						}

						await fetch(new URL(sub.topic, sub.server), {
							method: 'POST',
							body: notification.body,
							headers,
						}).then((res) => res.text());
						break;

					default:
						// @ts-expect-error
						throw new Error(`Unknown subscription type ${sub.type}`);
				}
			} catch (error) {
				this.log(`Failed to send push notification ${sub.id}`);
				this.log(error);
			}
		}
	}
}
