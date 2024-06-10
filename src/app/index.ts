import path from 'path';
import { IEventStore, NostrRelay, SQLiteEventStore } from '@satellite-earth/core';
import { BlossomSQLite, IBlobMetadataStore, LocalStorage } from 'blossom-server-sdk';
import { NostrEvent, SimplePool, kinds } from 'nostr-tools';
import { getDMRecipient } from '@satellite-earth/core/helpers/nostr';
import webPush from 'web-push';

import Database from './database.js';
import Graph from '../modules/graph/index.js';

import { SENSITIVE_KINDS } from '../const.js';
import { AUTH, DATA_PATH, OWNER_PUBKEY, COMMON_CONTACT_RELAYS, BOOTSTRAP_RELAYS } from '../env.js';
import ConfigManager from '../modules/config-manager.js';
import { BlobDownloader } from '../modules/blob-downloader.js';
import ControlApi from '../modules/control/control-api.js';
import ConfigActions from '../modules/control/config-actions.js';
import ReceiverActions from '../modules/control/receiver-actions.js';
import Receiver from '../modules/receiver/index.js';
import StatusLog from '../modules/status-log.js';
import LogActions from '../modules/control/log-actions.js';
import DatabaseActions from '../modules/control/database-actions.js';
import { formatPubkey, isHex } from '../helpers/pubkey.js';
import DirectMessageManager from '../modules/direct-message-manager.js';
import DirectMessageActions from '../modules/control/dm-actions.js';
import AddressBook from '../modules/address-book.js';
import NotificationsManager from '../modules/notifications-manager.js';
import AppState from '../modules/app-state.js';
import NotificationActions from '../modules/control/notification-actions.js';
import ProfileBook from '../modules/profile-book.js';
import { getOutboxes } from '../helpers/mailboxes.js';
import { AbstractRelay } from 'nostr-tools/abstract-relay';
import CautiousPool from '../modules/cautious-pool.js';
import { PrivateNodeConfig } from '@satellite-earth/core/types/private-node-config.js';
import RemoteAuthActions from '../modules/control/remote-auth-actions.js';

export default class App {
	running = false;

	config: ConfigManager;
	state: AppState;
	database: Database;
	eventStore: IEventStore;
	graph: Graph;
	relay: NostrRelay;
	receiver: Receiver;
	control: ControlApi;
	statusLog = new StatusLog();

	pool: CautiousPool;
	addressBook: AddressBook;
	profileBook: ProfileBook;
	directMessageManager: DirectMessageManager;

	notifications: NotificationsManager;

	blobMetadata: IBlobMetadataStore;
	blobStorage: LocalStorage;
	blobDownloader: BlobDownloader;

	constructor(dataPath: string) {
		const configPath = path.join(dataPath, 'node.json');
		const statePath = path.join(dataPath, 'state.json');

		this.state = new AppState(statePath);
		this.state.read();

		this.config = new ConfigManager(configPath);
		this.config.read();

		// setup VAPID keys if they don't exist
		if (!this.config.data.vapidPrivateKey || !this.config.data.vapidPublicKey) {
			const keys = webPush.generateVAPIDKeys();
			this.config.data.vapidPublicKey = keys.publicKey;
			this.config.data.vapidPrivateKey = keys.privateKey;
			this.config.write();
		}

		// set owner pubkey from env variable
		if (!this.config.data.owner && OWNER_PUBKEY && isHex(OWNER_PUBKEY)) {
			this.config.data.owner = OWNER_PUBKEY;
		}

		// Init embedded sqlite database
		this.database = new Database({
			directory: dataPath,
			reportInterval: 1000,
		});

		const isConnectedToSelf = (relay: AbstractRelay, challenge: string) => {
			for (const [socket, auth] of this.relay.auth) {
				if (auth.challenge === challenge) return true;
			}
			return false;
		};
		this.pool = new CautiousPool(isConnectedToSelf);

		this.eventStore = new SQLiteEventStore(this.database.db);
		this.eventStore.setup();

		this.addressBook = new AddressBook(this.eventStore, this.pool);
		this.profileBook = new ProfileBook(this.eventStore, this.pool);

		// set extra relays on address and profile book
		this.addressBook.extraRelays = [
			...COMMON_CONTACT_RELAYS,
			...Object.values(this.config.data.relays).map((r) => r.url),
		];
		this.profileBook.extraRelays = [
			...COMMON_CONTACT_RELAYS,
			...Object.values(this.config.data.relays).map((r) => r.url),
		];
		this.config.on('changed', (config) => {
			this.addressBook.extraRelays = [...COMMON_CONTACT_RELAYS, ...Object.values(config.relays).map((r) => r.url)];
			this.profileBook.extraRelays = [...COMMON_CONTACT_RELAYS, ...Object.values(config.relays).map((r) => r.url)];
		});

		// Fetch profiles for all incoming DMs
		this.eventStore.on('event:inserted', (event) => {
			switch (event.kind) {
				case kinds.EncryptedDirectMessage:
					const profile = this.profileBook.getProfile(event.pubkey);
					if (!profile) {
						this.profileBook.loadProfile(event.pubkey, this.addressBook.getOutboxes(event.pubkey));

						this.addressBook.loadMailboxes(event.pubkey).then((mailboxes) => {
							this.profileBook.loadProfile(event.pubkey, mailboxes ? getOutboxes(mailboxes) : undefined);
						});
					}
					break;
			}
		});

		// Initialize model of the social graph
		this.graph = new Graph();

		// Setup the notifications manager
		this.notifications = new NotificationsManager(this.eventStore, this.state);
		this.notifications.keys = {
			publicKey: this.config.data.vapidPublicKey!,
			privateKey: this.config.data.vapidPrivateKey!,
		};
		this.notifications.owner = this.config.data.owner;
		this.config.on('changed', (config) => (this.notifications.owner = config.owner));

		// Initializes receiver for pulling data from remote relays
		this.receiver = new Receiver(this.pool, this.graph);
		this.updateReceiverFromConfig();

		// update the receiver options when the config changes
		this.config.on('changed', (config, field) => {
			this.updateReceiverFromConfig(config);
			this.statusLog.log(`[CONFIG] set ${field}`);
		});

		// DM manager
		this.directMessageManager = new DirectMessageManager(this.database, this.eventStore, this.addressBook, this.pool);

		this.updateDirectMessageManager();
		this.config.on('changed', this.updateDirectMessageManager.bind(this));

		// update profiles when conversations are opened
		this.directMessageManager.on('open', (a, b) => {
			this.profileBook.loadProfile(a, this.addressBook.getOutboxes(a));
			this.profileBook.loadProfile(b, this.addressBook.getOutboxes(b));
		});

		// API for controlling the node
		this.control = new ControlApi(this, AUTH);
		this.control.registerHandler(new ConfigActions(this));
		this.control.registerHandler(new ReceiverActions(this));
		this.control.registerHandler(new LogActions(this));
		this.control.registerHandler(new DatabaseActions(this));
		this.control.registerHandler(new DirectMessageActions(this));
		this.control.registerHandler(new NotificationActions(this));
		this.control.registerHandler(new RemoteAuthActions(this));

		if (process.send) this.control.attachToProcess(process);

		this.blobMetadata = new BlossomSQLite(this.database.db);
		this.blobStorage = new LocalStorage(path.join(DATA_PATH, 'blobs'));
		this.blobDownloader = new BlobDownloader(this.blobStorage, this.blobMetadata);

		// Handle relay status reports
		this.receiver.on('started', () => this.statusLog.log('[CONTROL] SATELLITE RECEIVER LISTENING'));
		this.receiver.on('stopped', () => this.statusLog.log('[CONTROL] SATELLITE RECEIVER PAUSED'));

		this.receiver.on('event:received', (event) => {
			// Pass received events to the relay
			this.eventStore.addEvent(event);

			// NOTE: temporarily disable blob downloads
			// Pass the event to the blob downloader
			// if (event.pubkey === this.config.config.owner) {
			// 	this.blobDownloader.queueBlobsFromEventContent(event);
			// }

			// log event in status log
			this.logInsertedEvent(event);
		});

		this.relay = new NostrRelay(this.eventStore);
		this.relay.sendChallenge = true;
		this.relay.requireRelayInAuth = false;

		// only allow the owner to NIP-42 authenticate with the relay
		this.relay.checkAuth = (ws, auth) => {
			if (auth.pubkey !== this.config.data.owner) return 'Pubkey dose not match owner';
			return true;
		};

		// when the owner to NIP-42 authenticates with the relay pass it along to the control
		this.relay.on('socket:auth', (ws, auth) => {
			if (auth.pubkey === this.config.data.owner) {
				this.control.authenticatedConnections.add(ws);
			}
		});

		// if socket is unauthenticated only allow owner's events and incoming DMs
		this.relay.registerEventHandler((ctx, next) => {
			const auth = ctx.relay.getSocketAuth(ctx.socket);

			if (!auth) {
				// is it an incoming DM for the owner?
				if (ctx.event.kind === kinds.EncryptedDirectMessage && getDMRecipient(ctx.event) === this.config.data.owner)
					return next();

				if (ctx.event.pubkey === this.config.data.owner) return next();

				throw new Error(ctx.relay.makeAuthRequiredReason('This relay only accepts events from its owner'));
			}

			return next();
		});

		// handle forwarding direct messages by owner
		this.relay.registerEventHandler(async (ctx, next) => {
			if (ctx.event.kind === kinds.EncryptedDirectMessage && ctx.event.pubkey === this.config.data.owner) {
				// send direct message
				const results = await this.directMessageManager.forwardMessage(ctx.event);

				if (!results || !results.some((p) => p.status === 'fulfilled')) throw new Error('Failed to forward message');
				return `Forwarded message to ${results.filter((p) => p.status === 'fulfilled').length}/${results.length} relays`;
			} else return next();
		});

		// block subscriptions for sensitive kinds unless NIP-42 auth
		this.relay.registerSubscriptionFilter((ctx, next) => {
			const hasSensitiveKinds = ctx.filters.some(
				(filter) => filter.kinds && SENSITIVE_KINDS.some((k) => filter.kinds?.includes(k)),
			);

			if (hasSensitiveKinds) {
				const auth = ctx.relay.getSocketAuth(ctx.socket);
				if (!auth) throw new Error(ctx.relay.makeAuthRequiredReason('Cant view sensitive events without auth'));
			}

			return next();
		});
	}

	/** config -> direct message manager */
	updateDirectMessageManager(config: PrivateNodeConfig = this.config.data) {
		const relays = config.relays.map((r) => r.url);
		this.directMessageManager.updateExplicitRelays(relays.length > 0 ? relays : BOOTSTRAP_RELAYS);

		if (config.owner) this.directMessageManager.watchInbox(config.owner);
	}

	private updateReceiverFromConfig(config = this.config.data) {
		this.receiver.pubkeys.clear();
		this.receiver.explicitRelays.clear();

		if (config.owner) this.receiver.pubkeys.add(config.owner);
		for (const pubkey of config.pubkeys) this.receiver.pubkeys.add(pubkey);

		for (const relay of config.relays) this.receiver.explicitRelays.add(relay.url);

		this.receiver.cacheLevel = config.cacheLevel;
	}

	private logInsertedEvent(event: NostrEvent) {
		const profile = this.graph.getProfile(event.pubkey);
		const name = profile && profile.name ? profile.name : formatPubkey(event.pubkey);

		let preview;

		// Preview kinds 1 and 7, truncating at 256 chars
		if (event.kind === 1 || event.kind === 7) {
			preview = event.content.length > 256 ? event.content.slice(0, 256) : event.content;
		}

		this.statusLog.log(`[EVENT] KIND ${event.kind} FROM ${name}` + (preview ? ` "${preview}"` : ''));
	}

	start() {
		this.running = true;

		this.config.read();
		this.state.read();

		const events = this.eventStore.getEventsForFilters([{ kinds: [0, 3] }]);

		for (let event of events) {
			this.graph.add(event);
		}

		this.tick();
	}

	tick() {
		this.blobDownloader.downloadNext();

		if (this.running) setTimeout(this.tick.bind(this), 1000);
	}

	stop() {
		this.running = false;
		this.config.write();
		this.state.write();
		this.relay.stop();
		this.database.destroy();
		this.receiver.destroy();
	}
}
