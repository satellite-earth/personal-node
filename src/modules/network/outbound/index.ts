import { PacProxyAgent } from 'pac-proxy-agent';
import _throttle from 'lodash.throttle';

import { logger } from '../../../logger.js';
import ConfigManager from '../../config-manager.js';
import HyperOutbound from './hyper.js';
import TorOutbound from './tor.js';

export class OutboundNetworkManager {
	log = logger.extend('OutboundNetworkManager');
	hyper: HyperOutbound;
	tor: TorOutbound;

	running = false;
	agent: PacProxyAgent<string>;

	enableHyperConnections = false;
	enableTorConnections = false;
	enableI2PConnections = false;

	constructor() {
		this.hyper = new HyperOutbound();
		this.tor = new TorOutbound();

		this.agent = new PacProxyAgent(this.buildPacURI(), { fallbackToDirect: true });
	}

	private buildPacURI() {
		// 		const I2pConfig = this.enableI2PConnections
		// 			? `
		// if (shExpMatch(host, "*.i2p"))
		// {
		// 	return "SOCKS5 ${'I2P_PROXY'}";
		// }
		// 				`.trim()
		// 			: '';
		const TorConfig =
			this.tor.available && this.enableTorConnections
				? `
if (shExpMatch(host, "*.onion"))
{
	return "SOCKS5 ${''}";
}
				`.trim()
				: '';

		const HyperConfig =
			this.hyper.available && this.enableHyperConnections
				? `
if (shExpMatch(host, "*.hyper"))
{
	return "SOCKS5 ${this.hyper.address}";
}
					`.trim()
				: '';

		const PACFile = `
// SPDX-License-Identifier: CC0-1.0

function FindProxyForURL(url, host)
{
	${TorConfig}
	${HyperConfig}
	return "DIRECT";
}
		`.trim();

		return 'pac+data:application/x-ns-proxy-autoconfig;base64,' + btoa(PACFile);
	}

	updateAgent(uri = this.buildPacURI()) {
		this.log('Updating PAC proxy agent');
		// copied from https://github.com/TooTallNate/proxy-agents/blob/main/packages/pac-proxy-agent/src/index.ts#L79C22-L79C51
		this.agent.uri = new URL(uri.replace(/^pac\+/i, ''));

		// forces the agent to refetch the resolver and pac file
		this.agent.resolverPromise = undefined;
	}

	updateAgentThrottle: () => void = _throttle(this.updateAgent.bind(this), 100);

	/** A helper method to make the manager run off of the app config */
	listenToAppConfig(config: ConfigManager) {
		config.on('updated', (c) => {
			this.enableHyperConnections = c.hyperEnabled && c.enableHyperConnections;
			this.enableTorConnections = c.enableTorConnections;
			this.enableI2PConnections = c.enableI2PConnections;

			if (this.hyper.available && this.enableHyperConnections !== this.hyper.running) {
				if (this.enableHyperConnections) this.hyper.start();
				else this.hyper.stop();
			}

			if (this.tor.available && this.enableTorConnections !== this.tor.running) {
				if (this.enableTorConnections) this.tor.start();
				else this.tor.stop();
			}

			this.updateAgentThrottle();
		});
	}

	async stop() {
		await this.hyper.stop();
		await this.tor.stop();
	}
}

const outboundNetwork = new OutboundNetworkManager();

export default outboundNetwork;
