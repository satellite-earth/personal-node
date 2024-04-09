import fs from 'fs';
import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';

import { OWNER_PUBKEY } from '../env.js';
import { logger } from '../logger.js';

export type AppConfig = {
	owner?: string;
	pubkeys: string[];
	relays: { url: string }[];

	dashboardAuth: string;
	cacheLevel: 1 | 2 | 3;
	autoListen: boolean;
	logsEnabled: boolean;
};

type EventMap = {
	'config:loaded': [AppConfig];
	'config:updated': [AppConfig];
	'config:saved': [AppConfig];
};

export default class ConfigManager extends EventEmitter<EventMap> {
	log = logger.extend('config-manager');
	path: string;
	config: AppConfig;

	constructor(path: string) {
		super();
		this.path = path;

		this.config = this.loadConfig();
	}

	loadConfig() {
		try {
			const str = fs.readFileSync(this.path, { encoding: 'utf-8' });
			const config = JSON.parse(str) as AppConfig;

			if (!config.owner) throw new Error('Missing owner');

			// set defaults if they are not already set
			if (config.pubkeys === undefined) config.pubkeys = [];
			if (config.relays === undefined) config.relays = [];
			if (config.cacheLevel === undefined) config.cacheLevel = 2;
			if (config.autoListen === undefined) config.autoListen = false;
			if (config.logsEnabled === undefined) config.logsEnabled = true;
			if (config.dashboardAuth === undefined) config.dashboardAuth = randomBytes(20).toString('hex');

			this.config = config;

			this.log('Loaded config', this.config);
			this.emit('config:loaded', this.config);
			return config;
		} catch (e) {
			this.config = {
				owner: OWNER_PUBKEY,
				pubkeys: [],
				relays: [],
				cacheLevel: 2,
				autoListen: false,
				logsEnabled: true,
				dashboardAuth: randomBytes(20).toString('hex'),
			};

			this.log('Creating default config', this.config);
			this.saveConfig();

			return this.config;
		}
	}

	updateConfig(config: Partial<AppConfig>) {
		Object.assign(this.config, config);
		this.emit('config:updated', this.config);
		this.saveConfig();
	}

	saveConfig() {
		fs.writeFileSync(this.path, JSON.stringify(this.config, null, 2), { encoding: 'utf-8' });
		this.emit('config:saved', this.config);
	}
}
