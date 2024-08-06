import { mapParams } from '@satellite-earth/core/helpers/sql.js';
import { MigrationSet } from '@satellite-earth/core/sqlite';
import { type Database } from 'better-sqlite3';
import { EventEmitter } from 'events';
import { logger } from '../../logger.js';

const migrations = new MigrationSet('decryption-cache');

// Version 1
migrations.addScript(1, async (db, log) => {
	db.prepare(
		`
		CREATE TABLE "decryption_cache" (
			"event"	TEXT(64) NOT NULL,
			"content"	TEXT NOT NULL,
			PRIMARY KEY("event")
		);
	`,
	).run();
});

type EventMap = {
	cache: [string, string];
};

export default class DecryptionCache extends EventEmitter<EventMap> {
	database: Database;
	log = logger.extend('DecryptionCache');

	constructor(database: Database) {
		super();
		this.database = database;
	}

	setup() {
		return migrations.run(this.database);
	}

	/** cache the decrypted content of an event */
	addEventContent(id: string, plaintext: string) {
		const result = this.database
			.prepare<[string, string]>(`INSERT INTO decryption_cache (event, content) VALUES (?, ?)`)
			.run(id, plaintext);

		if (result.changes > 0) {
			this.log(`Saved content for ${id}`);

			this.emit('cache', id, plaintext);
		}
	}

	/** remove all cached content relating to a pubkey */
	clearPubkey(pubkey: string) {
		// this.database.prepare<string>(`DELETE FROM decryption_cache INNER JOIN events ON event=events.id`)
	}

	/** clear all cached content */
	clearAll() {
		this.database.prepare(`DELETE FROM decryption_cache`).run();
	}

	async getEventContent(id: string) {
		const result = this.database
			.prepare<[string], { event: string; content: string }>(`SELECT * FROM decryption_cache WHERE event=?`)
			.get(id);

		return result?.content;
	}
	async getEventsContent(ids: string[]) {
		return this.database
			.prepare<
				string[],
				{ event: string; content: string }
			>(`SELECT * FROM decryption_cache WHERE event IN ${mapParams(ids)}`)
			.all(...ids);
	}
}
