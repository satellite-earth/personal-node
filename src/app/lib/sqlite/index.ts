import EventEmitter from 'events';
import Database, { type Database as SQLDatabase } from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import { USE_PREBUILT_SQLITE_BINDINGS } from '../../../env.js';

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
						path.join(__dirname, '../../../../lib/bin'),
						`${process.arch === 'arm64' ? 'arm64' : 'x64'}/better_sqlite3.node`,
					)
				: undefined,
		});

		if (config.wal !== false) {
			this.db.pragma('journal_mode = WAL');
		}
	}

	// Delete all records in the database
	clear() {
		this.db.transaction(() => {
			this.db.prepare(`DELETE FROM tags`).run();
			this.db.prepare(`DELETE FROM event_labels`).run();
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

	stop() {
		this.removeAllListeners();
	}
}
