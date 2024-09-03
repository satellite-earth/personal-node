import App from '../../app/index.js';
import HyperServer from './hyper.js';
import { logger } from '../../logger.js';
import { getIPAddresses } from '../../helpers/ip.js';

/** manages all external servers, hyper, tor, i2p, etc... */
export default class ExternalServers {
	app: App;
	log = logger.extend('ExternalServers');
	hyper: HyperServer;
	running = false;

	get addresses() {
		const ip = getIPAddresses();
		const hyper = this.hyper.addresses;

		return [...(ip ?? []), ...(hyper ?? [])];
	}

	constructor(app: App) {
		this.app = app;

		this.hyper = new HyperServer(app);

		this.app.config.on('updated', () => this.updateHyper());
	}

	private getAddress() {
		const address = this.app.server.address();

		if (typeof address === 'string' || address === null)
			throw new Error('External servers started when server does not have an address');

		return address;
	}

	private async updateHyper() {
		if (!this.running) return;

		if (this.app.config.data.hyperEnabled !== this.hyper.running) {
			if (!this.hyper.running) await this.hyper.start(this.getAddress());
			else await this.hyper.stop();
		}
	}

	async start() {
		this.log('Starting servers');
		this.running = true;

		await this.updateHyper();
	}

	async stop() {
		this.running = false;
		await this.hyper.stop();
	}
}
