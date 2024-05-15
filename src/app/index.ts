import path from 'path';
import { IEventStore, NostrRelay, SQLiteEventStore } from '@satellite-earth/core';
import { BlossomSQLite, IBlobMetadataStore, LocalStorage } from 'blossom-server-sdk';

import Database from './database.js';
import Graph from '../modules/graph/index.js';

import { AUTH, DATA_PATH } from '../env.js';
import ConfigManager from '../modules/config-manager.js';
import { BlobDownloader } from '../modules/blob-downloader.js';
import ControlApi from '../modules/control/control-api.js';
import ConfigActions from '../modules/control/config-actions.js';
import ReceiverActions from '../modules/control/receiver-actions.js';
import Receiver from '../modules/receiver/index.js';
import StatusLog from '../modules/status-log.js';
import LogActions from '../modules/control/log-actions.js';
import DatabaseActions from '../modules/control/database-actions.js';
import { formatPubkey } from '../helpers/pubkey.js';
import { NostrEvent } from 'nostr-tools';

export default class App {
	running = false;

	config: ConfigManager;
	database: Database;
	eventStore: IEventStore;
	graph: Graph;
	relay: NostrRelay;
	receiver: Receiver;
	control: ControlApi;
	statusLog = new StatusLog();

	blobMetadata: IBlobMetadataStore;
	blobStorage: LocalStorage;
	blobDownloader: BlobDownloader;

	constructor(dataPath: string) {
		const configPath = path.join(dataPath, 'node.json');

		this.config = new ConfigManager(configPath);

		// Init embedded sqlite database
		this.database = new Database({
			directory: dataPath,
			reportInterval: 1000,
		});

		this.eventStore = new SQLiteEventStore(this.database.db);
		this.eventStore.setup();

		// Initialize model of the social graph
		this.graph = new Graph();

		// Initializes receiver for pulling data from remote relays
		this.receiver = new Receiver(this.graph);
		this.updateReceiverFromConfig();

		// update the receiver options when the config changes
		this.config.on('config:updated', (config, field) => {
			this.updateReceiverFromConfig(config);
			this.statusLog.log(`[CONFIG] set ${field}`);
		});

		// API for controlling the node
		this.control = new ControlApi(this, AUTH);
		this.control.registerHandler(new ConfigActions(this));
		this.control.registerHandler(new ReceiverActions(this));
		this.control.registerHandler(new LogActions(this));
		this.control.registerHandler(new DatabaseActions(this));

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

			// Pass the event to the blob downloader
			if (event.pubkey === this.config.config.owner) {
				this.blobDownloader.queueBlobsFromEventContent(event);
			}

			// log event in status log
			this.logInsertedEvent(event);
		});

		// Handle new events being saved
		this.eventStore.on('event:inserted', (event) => {
			// this.control.handleInserted(event);
		});

		this.relay = new NostrRelay(this.eventStore);
		this.relay.sendChallenge = true;
		this.relay.requireRelayInAuth = false;

		// only allow the owner to NIP-42 authenticate with the relay
		this.relay.checkAuth = (ws, auth) => {
			if (auth.pubkey !== this.config.config.owner) return 'Pubkey dose not match owner';
			return true;
		};

		// when the owner to NIP-42 authenticates with the relay pass it along to the control
		this.relay.on('socket:auth', (ws, auth) => {
			if (auth.pubkey === this.config.config.owner) {
				this.control.authenticatedConnections.add(ws);
			}
		});
	}

	private updateReceiverFromConfig(config = this.config.config) {
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

		const events = this.eventStore.getEventsForFilters([{ kinds: [0, 3] }]);

		for (let event of events) {
			this.graph.add(event);
		}

		// Set initial stats for the database
		// this.control.updateDatabaseStatus();

		this.tick();
	}

	tick() {
		this.blobDownloader.downloadNext();

		if (this.running) setTimeout(this.tick.bind(this), 1000);
	}

	stop() {
		this.running = false;
		this.relay.stop();
		this.database.destroy();
		this.receiver.destroy();
		// this.control.stop();
	}
}
