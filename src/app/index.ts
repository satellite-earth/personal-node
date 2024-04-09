import path from 'path';

import Database from './lib/sqlite/index.js';
import Graph from './lib/graph/index.js';
import Receiver from './lib/receiver/index.js';

import Control from './control/index.js';
import { IEventStore, SQLiteEventStore } from '../../../core/dist/index.js';

type AppConfig = {
	path: string;
	auth: string;
};

class App {
	config: AppConfig;
	database: Database;
	eventStore: IEventStore;
	graph: Graph;
	receiver: Receiver;
	control: Control;

	constructor(config: AppConfig) {
		this.config = config;

		console.log('app config', this.config);

		// Init embedded sqlite database
		this.database = new Database({
			directory: this.config.path,
			reportInterval: 1000,
		});

		this.eventStore = new SQLiteEventStore(this.database.db);
		this.eventStore.setup();

		// Initialize model of the social graph
		this.graph = new Graph();

		// Initializse receiver for pulling data from remote relays
		this.receiver = new Receiver(this.graph);

		// API for controlling the node by proxy - create config
		// file in the db directory unless otherwise specified
		this.control = new Control(this, {
			configPath: path.join(this.config.path, 'node.json'),
			controlAuth: (auth) => {
				return auth === this.config.auth;
			},
			//configPath: process.env.CONFIG_PATH || path.join(this.database.config.directory, 'node.json')
			//configPath: '/Users/sbowman/Library/Application Support/satellite-electron/config.json',
		});

		// Handle database status reports
		this.database.on('status', (data) => {
			// NOTE: this is missing for some reason, Im not sure what it dose
			// this.control.handleDatabaseStatus(data);
		});

		// Handle relay status reports
		this.receiver.on('relay:status', (data) => {
			this.control.handleRelayStatus(data);
		});

		// Pass received events to the relay
		this.receiver.on('event:received', (event) => {
			this.eventStore.addEvent(event);
		});

		// Handle new events being saved
		this.eventStore.on('event:inserted', (event) => {
			this.control.handleInserted(event);
		});
	}

	start() {
		const events = this.eventStore.getEventsForFilters([{ kinds: [0, 3] }]);

		for (let event of events) {
			this.graph.add(event);
		}

		// Set initial stats for the database
		this.control.updateDatabaseStatus();
	}

	stop() {
		this.database.stop();
		this.receiver.stop();
		this.control.stop();
	}
}

export default App;
