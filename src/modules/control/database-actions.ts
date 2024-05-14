import { WebSocket } from 'ws';
import os from 'node:os';
import { DatabaseMessage, DatabaseResponse } from '@satellite-earth/core/types/control-api.js';

import App from '../../app/index.js';
import { ControlMessageHandler } from './control-api.js';
import { writeJsonl } from '../../helpers/json.js';

export default class DatabaseActions implements ControlMessageHandler {
	app: App;
	name = 'DATABASE';

	subscribed = new Set<WebSocket | NodeJS.Process>();

	constructor(app: App) {
		this.app = app;

		// update all subscribed sockets every 5 seconds
		setInterval(() => {
			const stats = this.getStats();
			for (const sock of this.subscribed) {
				this.send(sock, ['CONTROL', 'DATABASE', 'STATS', stats]);
			}
		}, 5_000);
	}

	private getStats() {
		const count = this.app.database.count();
		const size = this.app.database.size();

		return { count, size };
	}

	handleMessage(sock: WebSocket | NodeJS.Process, message: DatabaseMessage): boolean {
		const action = message[2];
		switch (action) {
			case 'SUBSCRIBE':
				this.subscribed.add(sock);
				sock.once('close', () => this.subscribed.delete(sock));
				this.send(sock, ['CONTROL', 'DATABASE', 'STATS', this.getStats()]);
				return true;

			case 'UNSUBSCRIBE':
				this.subscribed.delete(sock);
				return true;

			case 'STATS':
				this.send(sock, ['CONTROL', 'DATABASE', 'STATS', this.getStats()]);
				return true;

			case 'EXPORT':
				this.exportDatabase();
				return true;

			case 'CLEAR':
				this.app.database.clear();
				this.app.statusLog.log('[control] DATABASE CLEARED');
				return true;

			default:
				return false;
		}
	}

	async exportDatabase() {
		let log;

		try {
			const t0 = Date.now();
			const events = this.app.eventStore.getEventsForFilters([{}]);

			await writeJsonl(events, {
				outputPath: os.homedir(),
				outputName: 'satellite-export',
				compress: true,
			});

			log = `[control] DATABASE EXPORT SUCCEEDED IN ${Date.now() - t0} MS`;
		} catch (err) {
			console.log(err);
			log = '[control] DATABASE EXPORT FAILED';
		}

		this.app.statusLog.log(log);
	}

	send(sock: WebSocket | NodeJS.Process, response: DatabaseResponse) {
		sock.send?.(JSON.stringify(response));
	}
}
