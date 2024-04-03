import EventEmitter from 'events';
import Sqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// TODO: find a better way to import these modules
import { SQLiteEventStore } from '../../../../core/dist/sqlite-event-store/index.js';

import { NATIVE_BINDINGS_PATH } from '../../../env.js';

const Util = {
	// If filter key is indexable
	indexable: (key) => {
		return key[0] === '#' && key.length === 2;
	},

	pmap: (_p) => {
		return `(${_p.map(() => `?`).join(', ')})`;
	},

	// Filter keys mapped to event
	filterMap: {
		ids: 'id',
		kinds: 'kind',
		authors: 'pubkey',
	},
};

class Database extends EventEmitter {
	constructor(config = {}) {
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
		this.db = new Sqlite3(this.path.main, {
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

		this.sub = {};

		this.eventStore = new SQLiteEventStore(this.db);
		this.eventStore.setup();

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

	addEvent(event, options) {
		const inserted = this.eventStore.addEvent(event, options);

		// TODO: update to just return boolean
		return inserted ? event : null;
	}

	removeEvent(params) {
		if (params.id) return this.eventStore.removeEvent(params.id);
	}

	addSubscription(subid, filters) {
		this.sub[subid] = filters.map((filter) => {
			const match = {};

			for (let key of Object.keys(filter)) {
				if (Util.filterMap[key]) {
					match[key] = new Set(filter[key]);
				} else if (Util.indexable(key)) {
					match[key.slice(1)] = new Set(filter[key]);
				}
			}

			return match;
		});
	}

	removeSubscription(subid) {
		delete this.sub[subid];
	}

	queryEvents(filters) {
		return this.eventStore.getEventsForFilters(filters);
	}

	matchSubscriptions(event) {
		const matched = [];
		const indexed = {};

		for (let tag of event.tags) {
			if (tag[0].length !== 1) {
				continue;
			}

			if (!indexed[tag[0]]) {
				indexed[tag[0]] = [];
			}

			indexed[tag[0]].push(tag[1]);
		}

		const match = (filter) => {
			for (let key of Object.keys(filter)) {
				if (Util.filterMap[key]) {
					// Authors, kinds, ids

					if (!filter[key].has(event[Util.filterMap[key]])) {
						return false;
					}
				} else if (indexed[key]) {
					// Single letter tags

					if (!indexed[key].some((item) => filter[key].has(item))) {
						return false;
					}
				} else if (key === 'since') {
					// Since

					if (event.created_at < filter.since) {
						return false;
					}
				} else if (key === 'until') {
					// Until

					if (event.created_at >= filter.until) {
						return false;
					}
				} else {
					return false;
				}
			}

			return true;
		};

		for (let subid of Object.keys(this.sub)) {
			for (let filter of this.sub[subid]) {
				if (match(filter)) {
					matched.push(subid);
					break;
				}
			}
		}

		return matched;
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
			.get();

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

export default Database;
