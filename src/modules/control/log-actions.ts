import { WebSocket } from 'ws';
import { LogMessage, LogResponse } from '@satellite-earth/core/types/control-api.js';

import { ControlMessageHandler } from './control-api.js';
import type App from '../../app/index.js';

export default class LogActions implements ControlMessageHandler {
	app: App;
	name = 'LOG';

	private subscribed = new Set<WebSocket | NodeJS.Process>();

	constructor(app: App) {
		this.app = app;

		this.app.statusLog.on('line', (line) => {
			for (const sock of this.subscribed) {
				this.send(sock, ['CONTROL', 'LOG', 'LINE', line]);
			}
		});

		this.app.statusLog.on('clear', () => {
			for (const sock of this.subscribed) {
				this.send(sock, ['CONTROL', 'LOG', 'CLEAR']);
			}
		});
	}

	handleMessage(sock: WebSocket | NodeJS.Process, message: LogMessage): boolean {
		const action = message[2];
		switch (action) {
			case 'SUBSCRIBE':
				this.subscribed.add(sock);
				sock.once('close', () => this.subscribed.delete(sock));

				// send last 50 lines
				for (let i = 0; i < 50 && i < this.app.statusLog.lines.length; i++) {
					this.send(sock, ['CONTROL', 'LOG', 'LINE', this.app.statusLog.lines[i]]);
				}
				return true;

			case 'UNSUBSCRIBE':
				this.subscribed.delete(sock);
				return true;

			case 'CLEAR':
				this.app.statusLog.clear();
				return true;

			default:
				return false;
		}
	}
	send(sock: WebSocket | NodeJS.Process, response: LogResponse) {
		sock.send?.(JSON.stringify(response));
	}
}
