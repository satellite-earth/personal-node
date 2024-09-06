import { logger } from '../../../logger.js';
import { OutboundInterface } from '../interfaces.js';
import { TOR_PROXY } from '../../../env.js';
import { testTCPConnection } from '../../../helpers/network.js';

export default class TorOutbound implements OutboundInterface {
	log = logger.extend('TorOutbound');

	readonly running = !!TOR_PROXY;
	error?: Error;
	readonly type = 'SOCKS5';
	readonly address = TOR_PROXY;
	readonly available = !!TOR_PROXY;

	async start() {
		try {
			this.log(`Connecting to ${TOR_PROXY}`);
			const [host, port] = this.address?.split(':') ?? [];
			if (!host || !port) throw new Error('Malformed proxy address');
			await testTCPConnection(host, parseInt(port), 3000);
		} catch (error) {
			if (error instanceof Error) this.error = error;
		}
	}

	async stop() {}
}
