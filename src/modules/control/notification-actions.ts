import { WebSocket } from 'ws';
import { NotificationsMessage, NotificationsResponse } from '@satellite-earth/core/types/control-api/notifications.js';

import { ControlMessageHandler } from './control-api.js';
import type App from '../../app/index.js';

export default class NotificationActions implements ControlMessageHandler {
	app: App;
	name = 'NOTIFICATIONS';

	constructor(app: App) {
		this.app = app;
	}

	handleMessage(sock: WebSocket | NodeJS.Process, message: NotificationsMessage): boolean {
		const action = message[2];
		switch (action) {
			case 'GET-VAPID-KEY':
				this.send(sock, ['CONTROL', 'NOTIFICATIONS', 'VAPID-KEY', this.app.notifications.keys.publicKey]);
				return true;

			case 'LIST':
				this.send(sock, ['CONTROL', 'NOTIFICATIONS', 'LIST', this.app.state.data.subscriptions]);
				return true;

			case 'REGISTER':
				this.app.notifications.registerSubscription(message[3]);
				return true;

			case 'UNREGISTER':
				this.app.notifications.unregisterSubscription(message[3]);
				return true;

			default:
				return false;
		}
	}
	send(sock: WebSocket | NodeJS.Process, response: NotificationsResponse) {
		sock.send?.(JSON.stringify(response));
	}
}
