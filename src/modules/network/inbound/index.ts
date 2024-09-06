import App from '../../../app/index.js';
import HyperInbound from './hyper.js';
import { logger } from '../../../logger.js';
import { getIPAddresses } from '../../../helpers/ip.js';
import TorInbound from './tor.js';
import ConfigManager from '../../config-manager.js';

/** manages all inbound servers on other networks: hyper, tor, i2p, etc... */
export default class InboundNetworkManager {
	app: App;
	log = logger.extend('InboundNetworkManager');
	hyper: HyperInbound;
	tor: TorInbound;

	running = false;
	get addresses() {
		const ip = getIPAddresses();
		const hyper = this.hyper.address;
		const tor = this.tor.address;

		return [...(ip ?? []), ...(tor ?? []), ...(hyper ?? [])];
	}

	constructor(app: App) {
		this.app = app;

		this.hyper = new HyperInbound(app);
		this.tor = new TorInbound(app);

		this.listenToAppConfig(app.config);
	}

	private getAddress() {
		const address = this.app.server.address();

		if (typeof address === 'string' || address === null)
			throw new Error('External servers started when server does not have an address');

		return address;
	}

	private update(config = this.app.config.data) {
		if (!this.running) return;
		const address = this.getAddress();

		if (this.hyper.available && config.hyperEnabled !== this.hyper.running) {
			if (config.hyperEnabled) this.hyper.start(address);
			else this.hyper.stop();
		}

		if (this.tor.available) {
			if (!this.tor.running) this.tor.start(address);
			else this.tor.stop();
		}
	}

	/** A helper method to make the manager run off of the app config */
	listenToAppConfig(config: ConfigManager) {
		config.on('updated', this.update.bind(this));
	}

	start() {
		this.running = true;
		this.update();
	}

	async stop() {
		this.running = false;
		await this.hyper.stop();
		await this.tor.stop();
	}
}
