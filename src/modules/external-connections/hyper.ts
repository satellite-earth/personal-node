import type { createProxy } from 'hyper-socks5-proxy';
import getPort from 'get-port';
import EventEmitter from 'events';

import { logger } from '../../logger.js';
import ConfigManager from '../config-manager.js';

type EventMap = {
	started: [];
	stopped: [];
};

class HyperProxy extends EventEmitter<EventMap> {
	log = logger.extend('HyperProxy');
	proxy?: ReturnType<typeof createProxy>;
	running = false;

	port?: number;
	address?: string;

	async start() {
		if (this.running) return;
		this.running = true;

		const { createProxy } = await import('hyper-socks5-proxy');
		const { getOrCreateNode } = await import('../../sidecars/hyperdht.js');

		this.port = await getPort({ port: 1080 });
		this.proxy = createProxy({ node: await getOrCreateNode() });

		this.log('Starting');
		this.address = `127.0.0.1:${this.port}`;
		this.proxy.listen(this.port, '127.0.0.1');
		this.log(`Listening on ${this.address}`);
		this.emit('started');
	}

	async stop() {
		if (!this.running) return;
		this.running = false;

		this.log('Stopping');
		await new Promise<void>((res) => this.proxy?.close(() => res()));
		this.proxy = undefined;
		this.emit('stopped');
	}
}

const hyperProxy = new HyperProxy();

/** starts and stops the hyper proxy based on the apps config */
export function listenToAppConfig(config: ConfigManager) {
	config.on('updated', (c) => {
		if (c.hyperEnabled !== hyperProxy.running) {
			if (c.hyperEnabled) hyperProxy.start();
			else hyperProxy.stop();
		}
	});
}

export default hyperProxy;
