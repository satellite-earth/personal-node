import { Database } from 'better-sqlite3';
import { Filter, NostrEvent } from 'nostr-tools';
import { IEventStore, SQLiteEventStore } from '@satellite-earth/core';
import { logger } from '../logger.js';

export function mapParams(params: any[]) {
	return `(${params.map(() => `?`).join(', ')})`;
}

export class LabeledEventStore extends SQLiteEventStore implements IEventStore {
	label: string;
	readAll = false;

	constructor(db: Database, label: string) {
		super(db);
		this.label = label;

		this.log = logger.extend(`event-store:` + label);
	}

	async setup() {
		await super.setup();

		this.db
			.prepare(
				`
				CREATE TABLE IF NOT EXISTS event_labels (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					event TEXT(64) REFERENCES events(id),
					label TEXT
				)
			`,
			)
			.run();

		this.db.prepare('CREATE INDEX IF NOT EXISTS event_labels_label ON event_labels(label)').run();
		this.db.prepare('CREATE INDEX IF NOT EXISTS event_labels_event ON event_labels(event)').run();
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

	addEvent(
		event: NostrEvent,
		options?: {
			preserveEphemeral?: boolean;
			preserveReplaceable?: boolean;
		},
	) {
		const inserted = super.addEvent(event, options);

		const hasLabel = !!this.db
			.prepare('SELECT * FROM event_labels WHERE event = ? AND label = ?')
			.get(event.id, this.label);
		if (!hasLabel) this.db.prepare(`INSERT INTO event_labels (event, label) VALUES (?, ?)`).run(event.id, this.label);

		return inserted;
	}

	removeEvents(ids: string[]) {
		this.db.prepare(`DELETE FROM event_labels WHERE event IN ${mapParams(ids)}`).run(...ids);
		return super.removeEvents(ids);
	}

	removeEvent(id: string) {
		this.db.prepare(`DELETE FROM event_labels WHERE event = ?`).run(id);
		return super.removeEvent(id);
	}
}
