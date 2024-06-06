import { JSONFileSync } from 'lowdb/node';
import _throttle from 'lodash.throttle';

import { logger } from '../logger.js';
import { PrivateNodeConfig } from '@satellite-earth/core/types/private-node-config.js';
import { ReactiveJsonFileSync } from '@satellite-earth/core';

export const defaultConfig: PrivateNodeConfig = {
	pubkeys: [],
	relays: [],
	cacheLevel: 2,
	autoListen: false,
	logsEnabled: true,
	requireReadAuth: false,
	publicAddresses: [],
};

export default class ConfigManager extends ReactiveJsonFileSync<PrivateNodeConfig> {
	log = logger.extend('config-manager');

	constructor(path: string) {
		super(new JSONFileSync(path), defaultConfig);
	}

	/** @deprecated use .update or .data[key] = value instead */
	setField(field: keyof PrivateNodeConfig, value: any) {
		// @ts-expect-error
		this.data[field] = value;

		this.write();
	}
}
