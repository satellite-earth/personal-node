import { nip19 } from 'nostr-tools';

export function formatPubkey(pubkey: string) {
	const npub = nip19.npubEncode(pubkey);

	return `${npub.slice(0, 9)}...${npub.slice(-4)}`;
}
