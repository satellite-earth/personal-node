import { WebSocket } from 'ws';
import { ReceiverMessage, ReceiverResponse } from '@satellite-earth/core/types/control-api.js';

import type App from '../../app/index.js';
import { type ControlMessageHandler } from './control-api.js';
import { ReceiverStatus } from '../receiver/index.js';

export default class ReceiverActions implements ControlMessageHandler {
	app: App;
	name = 'RECEIVER';

	constructor(app: App) {
		this.app = app;
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
				const listener = (status: ReceiverStatus) => this.send(sock, ['CONTROL', 'RECEIVER', 'STATUS', status]);
				this.app.receiver.on('status:changed', listener);
				sock.once('close', () => this.app.receiver.off('status:changed', listener));
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
