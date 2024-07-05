import { WebSocket } from 'ws';
import { ReceiverMessage, ReceiverResponse } from '@satellite-earth/core/types/control-api/receiver.js';

import type App from '../../app/index.js';
import { type ControlMessageHandler } from './control-api.js';

export default class ReceiverActions implements ControlMessageHandler {
	app: App;
	name = 'RECEIVER';

	private subscribed = new Set<WebSocket | NodeJS.Process>();

	constructor(app: App) {
		this.app = app;

		this.app.receiver.on('status:changed', (status: any) => {
			for (const sock of this.subscribed) {
				this.send(sock, ['CONTROL', 'RECEIVER', 'STATUS', status]);
			}
		});
	}
	handleMessage(sock: WebSocket | NodeJS.Process, message: ReceiverMessage): boolean {
		const action = message[2];
		switch (action) {
			case 'START':
				this.app.receiver.start();
				return true;

			case 'STOP':
				this.app.receiver.stop();
				return true;

			case 'SUBSCRIBE':
				this.subscribed.add(sock);
				sock.once('close', () => this.subscribed.delete(sock));
				this.send(sock, ['CONTROL', 'RECEIVER', 'STATUS', this.app.receiver.status]);
				return true;

			case 'UNSUBSCRIBE':
				this.subscribed.delete(sock);
				return true;

			case 'STATUS':
				this.send(sock, ['CONTROL', 'RECEIVER', 'STATUS', this.app.receiver.status]);
				return true;

			default:
				return false;
		}
	}

	send(sock: WebSocket | NodeJS.Process, response: ReceiverResponse) {
		sock.send?.(JSON.stringify(response));
	}
}
