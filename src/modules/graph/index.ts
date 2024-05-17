import { NostrEvent } from 'nostr-tools';

type Profile = { name: string };

export type Node = { p: string; z: number; n: number };

export default class Graph {
	profile: Record<string, { created_at: number; profile: Profile }> = {};
	contacts: Record<string, { created_at: number; set: Set<string> }> = {};

	add(event: NostrEvent) {
		if (event.kind === 0) {
			this.addProfile(event);
		} else if (event.kind === 3) {
			this.addContacts(event);
		}
	}

	addContacts(event: NostrEvent) {
		const existing = this.contacts[event.pubkey];

		// Add or overwrite an existing (older) contacts list
		if (!existing || existing.created_at < event.created_at) {
			const following = new Set(event.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]));

			this.contacts[event.pubkey] = {
				created_at: event.created_at,
				set: following,
			};
		}
	}

	addProfile(event: NostrEvent) {
		const existing = this.profile[event.pubkey];

		// Add or overwrite an existing (older) profile
		if (!existing || existing.created_at < event.created_at) {
			let profile;

			try {
				profile = JSON.parse(event.content);
			} catch (err) {
				console.log('Failed to parse profile', err);
			}

			if (profile) {
				this.profile[event.pubkey] = {
					created_at: event.created_at,
					profile: {
						name: profile.name || profile.display,
						// TODO maybe store other properties
						// TODO maybe truncate values
					},
				};
			}
		}
	}

	getNodes(roots: string[] = []): Node[] {
		const u: Record<string, { z: number; n: number }> = {};

		// Init u with root pubkeys
		for (let p of roots) {
			u[p] = { z: 0, n: 1 };
		}

		const populate = (pubkeys: string[], z: number) => {
			for (let p of pubkeys) {
				// If pubkey's contacts don't exist, skip it
				if (!this.contacts[p]) {
					continue;
				}

				//console.log('this.contacts[p].set', this.contacts[p].set);

				// Iterate across pubkey's contacts, if the
				// contact has not been recorded, create an
				// entry at the current degrees of separation,
				// otherwise increment the number of occurances
				this.contacts[p].set.forEach((c) => {
					// Don't count self-follow
					if (p === c) {
						return;
					}

					if (!u[c]) {
						u[c] = { z, n: 1 };
					} else {
						if (u[c].z > z) {
							return;
						}

						u[c].n++;
					}
				});
			}
		};

		// Populate u with all the pubkeys that
		// are directly followed by root pubkey
		populate(roots, 1);

		// On the second pass, populate u with
		// all the pubkeys that are followed
		// by any pubkey that root follows
		populate(
			Object.keys(u).filter((p) => {
				return u[p].z > 0;
			}),
			2
		);

		// Return list of pubkeys sorted by degrees
		// of separation and number of occurances
		return Object.keys(u)
			.map((p) => {
				return { ...u[p], p };
			})
			.sort((a, b) => {
				return a.z === b.z ? b.n - a.n : a.z - b.z;
			});
	}

	getProfile(pubkey: string) {
		const record = this.profile[pubkey];

		if (record) {
			return record.profile;
		}
	}
}
