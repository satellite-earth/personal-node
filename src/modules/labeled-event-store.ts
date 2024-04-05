import { Database } from 'better-sqlite3';
import { Filter, NostrEvent } from 'nostr-tools';
import { IEventStore, SQLiteEventStore } from '../../../core/dist/index.js';

export class LabeledEventStore extends SQLiteEventStore implements IEventStore {
	label: string;
	readAll = false;

	constructor(db: Database, label: string) {
		super(db);
		this.label = label;
	}

	async setup() {
		await super.setup();

		this.db
			.prepare(
				`
				CREATE TABLE IF NOT EXISTS event_labels (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					event TEXT(64) UNIQUE REFERENCES events(id),
					label TEXT
				)
			`,
			)
			.run();

		this.db
			.prepare(
				'CREATE INDEX IF NOT EXISTS event_labels_label ON event_labels(label)',
			)
			.run();
		this.db
			.prepare(
				'CREATE INDEX IF NOT EXISTS event_labels_event ON event_labels(event)',
			)
			.run();
	}

	protected buildSQLQueryForFilter(filter: Filter) {
		if (this.readAll) return super.buildSQLQueryForFilter(filter);
		else
			return super.buildSQLQueryForFilter(filter, {
				extraJoin: 'INNER JOIN event_labels ON events.id = event_labels.event',
				extraConditions: ['event_labels.label = ?'],
				extraParameters: [this.label],
			});
	}

	addEvent(event: NostrEvent) {
		const inserted = super.addEvent(event);

		if (inserted)
			this.db
				.prepare(`INSERT INTO event_labels (event, label) VALUES (?, ?)`)
				.run(event.id, this.label);

		return inserted;
	}

	removeEvent(id: string) {
		const removed = super.removeEvent(id);

		if (removed)
			this.db.prepare(`DELETE * FROM event_labels WHERE event=?`).run(id);

		return removed;
	}
}
