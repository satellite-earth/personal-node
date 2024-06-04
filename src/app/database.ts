import EventEmitter from 'events';
import Database, { type Database as SQLDatabase } from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import { USE_PREBUILT_SQLITE_BINDINGS } from '../env.js';
import { DMStats } from '@satellite-earth/core/types/control-api/direct-messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default class LocalDatabase extends EventEmitter {
	config: any;
	path: { main: string; shm: string; wal: string };

	db: SQLDatabase;

	constructor(config: any = {}) {
		super();

		this.config = {
			directory: 'data',
			name: 'events',
			...config,
		};

		this.path = {
			main: path.join(this.config.directory, `${this.config.name}.db`),
			shm: path.join(this.config.directory, `${this.config.name}.db-shm`),
			wal: path.join(this.config.directory, `${this.config.name}.db-wal`),
		};

		// Detect architecture to pass the correct native sqlite module
		this.db = new Database(this.path.main, {
			// Optionally use native bindings indicated by environment
			nativeBinding: USE_PREBUILT_SQLITE_BINDINGS
				? path.join(
						path.join(__dirname, '../../lib/bin'),
						`${process.arch === 'arm64' ? 'arm64' : 'x64'}/better_sqlite3.node`,
					)
				: undefined,
		});

		if (config.wal !== false) {
			this.db.pragma('journal_mode = WAL');
		}
	}

	hasTable(table: string) {
		const result = this.db
			.prepare(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?`)
			.get([table]) as { count: number };
		return result.count > 0;
	}

	// Delete all records in the database
	clear() {
		this.db.transaction(() => {
			this.db.prepare(`DELETE FROM tags`).run();
			if (this.hasTable('event_labels')) this.db.prepare(`DELETE FROM event_labels`).run();
			this.db.prepare(`DELETE FROM events`).run();
		})();
	}

	// Get number of events in the database
	count() {
		const result = this.db.prepare(`SELECT COUNT(*) AS events FROM events`).get() as { events: number };

		return result.events;
	}

	// Get total size of the database on disk
	size() {
		let sum;

		try {
			const statMain = fs.statSync(this.path.main);
			const statShm = fs.statSync(this.path.shm);
			const statWal = fs.statSync(this.path.wal);

			sum = statMain.size + statShm.size + statWal.size;
		} catch (err) {
			console.log(err);
		}

		return sum;
	}

	destroy() {
		this.removeAllListeners();
	}

	/** returns a directory of all kind:4 messages send to and received from pubkeys */
	async getKind4MessageCount(owner: string) {
		const sent = this.db
			.prepare<[string], { pubkey: string; count: number; lastMessage: number }>(
				`
				SELECT tags.v as pubkey, count(tags.v) as count, max(events.created_at) as lastMessage FROM tags
				INNER JOIN events ON events.id = tags.e
				WHERE events.kind = 4 AND tags.t = 'p' AND events.pubkey = ?
				GROUP BY tags.v`,
			)
			.all(owner);

		const received = this.db
			.prepare<[string], { pubkey: string; count: number; lastMessage: number }>(
				`
				SELECT events.pubkey, count(events.pubkey) as count, max(events.created_at) as lastMessage FROM events
				INNER JOIN tags ON tags.e = events.id
				WHERE events.kind = 4 AND tags.t = 'p' AND tags.v = ?
				GROUP BY events.pubkey`,
			)
			.all(owner);

		const messages: DMStats = {};

		for (const { pubkey, count, lastMessage } of received) {
			messages[pubkey] = messages[pubkey] || { sent: 0, received: 0 };
			messages[pubkey].received = count;
			messages[pubkey].lastReceived = lastMessage;
		}
		for (const { pubkey, count, lastMessage } of sent) {
			messages[pubkey] = messages[pubkey] || { sent: 0, received: 0 };
			messages[pubkey].sent = count;
			messages[pubkey].lastSent = lastMessage;
		}

		return messages;
	}
}
