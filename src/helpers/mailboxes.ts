import { NostrEvent } from 'nostr-tools';
import { safeRelayUrls } from './relays.js';

// inbox relays can be ["r", <url>, "read"] or ["r", <url>]
export function getInboxes(event: NostrEvent) {
	const tags = event.tags.filter((t) => (t[0] === 'r' && t[2] === 'read') || t[2] === undefined);
	return safeRelayUrls(tags.map((t) => t[1]));
}

export function getOutboxes(event: NostrEvent) {
	const tags = event.tags.filter((t) => (t[0] === 'r' && t[2] === 'write') || t[2] === undefined);
	return safeRelayUrls(tags.map((t) => t[1]));
}
