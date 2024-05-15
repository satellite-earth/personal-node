import fs from 'fs';
import { EventEmitter } from 'events';

import { OWNER_PUBKEY } from '../env.js';
import { logger } from '../logger.js';

export type AppConfig = {
	owner?: string;
	pubkeys: string[];
	relays: { url: string }[];

	cacheLevel: 1 | 2 | 3;

	/**
	 * Whether the node should require NIP-42 auth to read
	 * Desktop: false by default
	 * Hosted: true by default
	 */
	requireReadAuth: boolean;

	/**
	 * various address that this node can be reached from
	 * Desktop: default to empty
	 * Hosted: default to public facing URLs
	 */
	publicAddresses: string[];

	/** @deprecated this should probably be moved to desktop */
	autoListen: boolean;
	/** @deprecated this should always be enabled */
	logsEnabled: boolean;
};

export const defaultConfig: AppConfig = {
	pubkeys: [],
	relays: [],
	cacheLevel: 2,
	autoListen: false,
	logsEnabled: true,
	requireReadAuth: false,
	publicAddresses: [],
};

type EventMap = {
	'config:loaded': [AppConfig];
	'config:updated': [AppConfig, string, any];
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

	setField(field: keyof AppConfig, value: any) {
		if (Reflect.has(this.config, field)) {
			// @ts-expect-error
			this.config[field] = value;

			this.emit('config:updated', this.config, field, value);
			this.saveConfig();
		}
	}

	loadConfig() {
		try {
			const str = fs.readFileSync(this.path, { encoding: 'utf-8' });
			const config = { ...defaultConfig, ...(JSON.parse(str) as AppConfig) };

			if (!config.owner) throw new Error('Missing owner');

			this.config = config;

			this.log('Loaded config', this.config);
			this.emit('config:loaded', this.config);
			return config;
		} catch (e) {
			this.config = {
				...defaultConfig,
				owner: OWNER_PUBKEY,
			};

			this.log('Creating default config', this.config);
			this.saveConfig();

			return this.config;
		}
	}

	saveConfig() {
		fs.writeFileSync(this.path, JSON.stringify(this.config, null, 2), { encoding: 'utf-8' });
		this.emit('config:saved', this.config);
	}
}
