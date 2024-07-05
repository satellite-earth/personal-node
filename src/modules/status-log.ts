import EventEmitter from 'events';
import { NostrEvent } from 'nostr-tools';
import { formatPubkey } from '../helpers/pubkey.js';
import App from '../app/index.js';

type EventMap = {
	line: [string];
	clear: [];
};

export default class StatusLog extends EventEmitter<EventMap> {
	lines: string[] = [];
	app: App;

	constructor(app: App) {
		super();
		this.app = app;
	}

	logEvent(event: NostrEvent) {
		//const profile = this.app.graph.getProfile(event.pubkey);
		//const name = profile && profile.name ? profile.name : formatPubkey(event.pubkey);
		const name = formatPubkey(event.pubkey);
		let preview;

		// Preview kinds 1 and 7, truncating at 256 chars
		if (event.kind === 1 || event.kind === 7) {
			preview = event.content.length > 256 ? event.content.slice(0, 256) : event.content;
		}

		this.log(`[EVENT] KIND ${event.kind} FROM ${name}` + (preview ? ` "${preview}"` : ''));
	}

	log(...args: any[]) {
		const line = Array.from(args)
			.map((e) => String(e))
			.join(' ');
		this.lines.unshift(line);

		this.emit('line', line);
	}

	clear() {
		this.lines = [];
		this.emit('clear');
	}
}
