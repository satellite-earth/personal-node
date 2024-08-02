import path from 'path';
import { IEventStore, NostrRelay, SQLiteEventStore } from '@satellite-earth/core';
import { getDMRecipient } from '@satellite-earth/core/helpers/nostr';
import { BlossomSQLite, IBlobMetadataStore, LocalStorage } from 'blossom-server-sdk';
import { kinds } from 'nostr-tools';
import webPush from 'web-push';

import Database from './database.js';

import { SENSITIVE_KINDS } from '../const.js';
import { AUTH, DATA_PATH, OWNER_PUBKEY } from '../env.js';

import { isHex } from '../helpers/pubkey.js';
import { getOutboxes } from '../helpers/mailboxes.js';

import ConfigManager from '../modules/config-manager.js';
import { BlobDownloader } from '../modules/blob-downloader.js';
import ControlApi from '../modules/control/control-api.js';
import ConfigActions from '../modules/control/config-actions.js';
import ReceiverActions from '../modules/control/receiver-actions.js';
import Receiver from '../modules/receiver/index.js';
import StatusLog from '../modules/status-log.js';
import LogActions from '../modules/control/log-actions.js';
import DatabaseActions from '../modules/control/database-actions.js';
import DirectMessageManager from '../modules/direct-message-manager.js';
import DirectMessageActions from '../modules/control/dm-actions.js';
import AddressBook from '../modules/address-book.js';
import NotificationsManager from '../modules/notifications-manager.js';
import AppState from '../modules/app-state.js';
import NotificationActions from '../modules/control/notification-actions.js';
import ProfileBook from '../modules/profile-book.js';
import ContactBook from '../modules/contact-book.js';
import { AbstractRelay } from 'nostr-tools/abstract-relay';
import CautiousPool from '../modules/cautious-pool.js';
import RemoteAuthActions from '../modules/control/remote-auth-actions.js';
import ReportActions from '../modules/control/report-actions.js';
import OverviewReport from '../modules/reports/overview.js';
import ConversationsReport from '../modules/reports/conversations.js';
import LogsReport from '../modules/reports/logs.js';
import LogStore from '../modules/logs/log-store.js';
import ServicesReport from '../modules/reports/services.js';

export default class App {
	running = false;
	config: ConfigManager;
	state: AppState;
	database: Database;
	eventStore: IEventStore;
	logStore: LogStore;
	relay: NostrRelay;
	receiver: Receiver;
	control: ControlApi;
	reports: ReportActions;
	statusLog: StatusLog;
	pool: CautiousPool;
	addressBook: AddressBook;
	profileBook: ProfileBook;
	contactBook: ContactBook;
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

		this.statusLog = new StatusLog(this);

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
		this.database = new Database({ directory: dataPath });

		// create log managers
		this.logStore = new LogStore(this.database.db);
		this.logStore.setup();

		// Recognize local relay by matching auth string
		this.pool = new CautiousPool((relay: AbstractRelay, challenge: string) => {
			for (const [socket, auth] of this.relay.auth) {
				if (auth.challenge === challenge) return true;
			}
			return false;
		});

		// Initialize the event store
		this.eventStore = new SQLiteEventStore(this.database.db);
		this.eventStore.setup();

		// Setup managers user contacts and profiles
		this.addressBook = new AddressBook(this /*this.eventStore, this.pool*/);
		this.profileBook = new ProfileBook(this /*this.eventStore, this.pool*/);
		this.contactBook = new ContactBook(this);

		// Handle possible additional actions when
		// the event store receives a new message
		this.eventStore.on('event:inserted', (event) => {
			// Fetch profiles for all incoming DMs
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

		// Setup the notifications manager
		this.notifications = new NotificationsManager(this /*this.eventStore, this.state*/);
		this.notifications.keys = {
			publicKey: this.config.data.vapidPublicKey!,
			privateKey: this.config.data.vapidPrivateKey!,
		};

		// Initializes receiver for pulling data from remote relays
		this.receiver = new Receiver(this);
		//this.updateReceiverFromConfig();

		// DM manager
		this.directMessageManager = new DirectMessageManager(this);

		// set watchInbox for owner when config is loaded or changed
		this.config.on('updated', (config) => {
			if (config.owner) this.directMessageManager.watchInbox(config.owner);
		});

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

		// reports
		this.reports = new ReportActions(this);
		this.reports.types = {
			OVERVIEW: OverviewReport,
			CONVERSATIONS: ConversationsReport,
			LOGS: LogsReport,
			SERVICES: ServicesReport,
		};
		this.control.registerHandler(this.reports);

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
			this.statusLog.logEvent(event);

			// NOTE: temporarily disable blob downloads
			// Pass the event to the blob downloader
			// if (event.pubkey === this.config.config.owner) {
			// 	this.blobDownloader.queueBlobsFromEventContent(event);
			// }
		});

		this.relay = new NostrRelay(this.eventStore);
		this.relay.sendChallenge = true;
		this.relay.requireRelayInAuth = false;

		// only allow the owner to NIP-42 authenticate with the relay
		this.relay.checkAuth = (ws, auth) => {
			// If owner is not set, update it to match the pubkey
			// that signed the auth message. This allows the user
			// to set the owner pubkey from the initial login when
			// setting up their personal node (the owner pubkey may
			// otherwise be set using the env var `OWNER_PUBKEY`)
			if (!this.config.data.owner) {
				this.config.update((config) => {
					config.owner = auth.pubkey;
				});
				return true;
			}
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

	// TODO this method can be removed
	// the receiver just needs to know the
	// owner pubkey and have access to the
	// address book to get the outboxes
	/*
	private updateReceiverFromConfig(config = this.config.data) {
		this.receiver.pubkeys.clear();
		this.receiver.explicitRelays.clear();

		if (config.owner) this.receiver.pubkeys.add(config.owner);
		for (const pubkey of config.pubkeys) this.receiver.pubkeys.add(pubkey);

		for (const relay of config.relays) this.receiver.explicitRelays.add(relay.url);

		this.receiver.cacheLevel = config.cacheLevel;
	}
	*/

	start() {
		this.running = true;
		this.config.read();
		this.state.read();
		//this.socialGraph.initialize();
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
		this.reports.cleanup();
		this.relay.stop();
		this.database.destroy();
		this.receiver.destroy();
	}
}
