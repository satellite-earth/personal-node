import path from 'path';
import { IEventStore, SQLiteEventStore } from '@satellite-earth/core';
import { BlossomSQLite, IBlobMetadataStore, LocalStorage } from 'blossom-server-sdk';

import Database from './lib/sqlite/index.js';
import Graph from './lib/graph/index.js';
import Receiver from './lib/receiver/index.js';

import Control from './control/index.js';
import ConfigManager from './config-manager.js';
import { BlobDownloader } from '../modules/blob-downloader.js';
import { DATA_PATH } from '../env.js';

class App {
	running = false;

	config: ConfigManager;
	database: Database;
	eventStore: IEventStore;
	graph: Graph;
	receiver: Receiver;
	control: Control;

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

		// API for controlling the node by proxy - create config
		// file in the db directory unless otherwise specified
		this.control = new Control(this, {
			controlAuth: (auth) => {
				return auth === this.config.config.dashboardAuth;
			},
			//configPath: process.env.CONFIG_PATH || path.join(this.database.config.directory, 'node.json')
			//configPath: '/Users/sbowman/Library/Application Support/satellite-electron/config.json',
		});

		this.blobMetadata = new BlossomSQLite(this.database.db);
		this.blobStorage = new LocalStorage(path.join(DATA_PATH, 'blobs'));
		this.blobDownloader = new BlobDownloader(this.blobStorage, this.blobMetadata);

		// Handle database status reports
		this.database.on('status', (data) => {
			// NOTE: this is missing for some reason, Im not sure what it dose
			// this.control.handleDatabaseStatus(data);
		});

		// Handle relay status reports
		this.receiver.on('relay:status', (data) => {
			this.control.handleRelayStatus(data);
		});

		this.receiver.on('event:received', (event) => {
			// Pass received events to the relay
			this.eventStore.addEvent(event);

			// Pass the event to the blob downloader
			if (event.pubkey === this.config.config.owner) {
				this.blobDownloader.queueBlobsFromEventContent(event);
			}
		});

		// Handle new events being saved
		this.eventStore.on('event:inserted', (event) => {
			this.control.handleInserted(event);
		});
	}

	start() {
		this.running = true;

		const events = this.eventStore.getEventsForFilters([{ kinds: [0, 3] }]);

		for (let event of events) {
			this.graph.add(event);
		}

		// Set initial stats for the database
		this.control.updateDatabaseStatus();

		this.tick();
	}

	tick() {
		this.blobDownloader.downloadNext();

		if (this.running) setTimeout(this.tick.bind(this), 1000);
	}

	stop() {
		this.running = false;
		this.database.stop();
		this.receiver.stop();
		this.control.stop();
	}
}

export default App;
