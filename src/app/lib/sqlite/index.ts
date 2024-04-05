import EventEmitter from 'events';
import Database, { type Database as SQLDatabase } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

import { NATIVE_BINDINGS_PATH } from '../../../env.js';

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
			// TODO these binaries should not be stored in this package,
			// they need to be moved to the electron app instead, and
			// the electron app needs to pass down the path to a folder
			// that contains a structure like

			// /arm64/better_sqlite3.node
			// /x86/better_sqlite3.node

			// Optionally use native bindings indicated by environment
			nativeBinding: NATIVE_BINDINGS_PATH
				? path.join(
						NATIVE_BINDINGS_PATH,
						`${process.arch === 'arm64' ? 'arm64' : 'x64'}/better_sqlite3.node`,
					)
				: undefined,

			// nativeBinding: path.join(
			// 	__dirname,
			// 	`bin/${process.arch === 'arm64' ? 'arm64' : 'x86'}/better_sqlite3.node`
			// )
		});

		if (config.wal !== false) {
			this.db.pragma('journal_mode = WAL');
		}

		// if (config.reportInterval) {

		// 	this._status = setInterval(() => {

		// 		this.emit('status', {
		// 			size: this.size(),
		// 			count: this.count()
		// 		});

		// 	}, config.reportInterval);
		// }
	}

	// Delete all records in the database
	clear() {
		this.db.transaction(() => {
			this.db.prepare(`DELETE FROM tags`).run();
			this.db.prepare(`DELETE FROM events`).run();
		})();
	}

	// Get number of events in the database
	count() {
		const result = this.db
			.prepare(`SELECT COUNT(*) AS events FROM events`)
			.get() as { events: number };

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
