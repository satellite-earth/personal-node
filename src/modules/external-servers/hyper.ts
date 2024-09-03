import HolesailServer from 'holesail-server';
import { encodeAddress } from 'hyper-address';
import { hexToBytes } from '@noble/hashes/utils';

import App from '../../app/index.js';
import { IExternalServer } from './interface.js';
import { logger } from '../../logger.js';
import { AddressInfo } from 'net';

/** manages a holesail-server instance that points to the app.server http server */
export default class HyperServer implements IExternalServer {
	app: App;
	hyper?: HolesailServer;
	log = logger.extend('HyperServer');

	running = false;
	startError?: Error;
	addresses?: string[] | undefined;

	constructor(app: App) {
		this.app = app;
	}

	async start(address: AddressInfo) {
		this.running = true;
		this.startError = undefined;

		this.log(`Importing and starting hyperdht node`);

		try {
			const { default: HolesailServer } = await import('holesail-server');
			const { getOrCreateNode } = await import('../../sidecars/hyperdht.js');

			const hyper = (this.hyper = new HolesailServer());
			hyper.dht = getOrCreateNode();

			return new Promise<void>((res) => {
				hyper.serve(
					{
						port: address.port,
						address: address.address,
						secure: false,
						buffSeed: this.app.secrets.get('hyperKey'),
					},
					() => {
						const address = encodeAddress(hexToBytes(hyper.getPublicKey()));
						this.addresses = [address];

						this.log(`Listening on ${address}`);
						res();
					},
				);
			});
		} catch (error) {
			this.running = false;
			if (error instanceof Error) this.startError = error;
		}
	}

	async stop() {
		this.log('Shutting down');
		// disabled because holesail-server destroys the hyperdht node
		// this.hyper?.destroy();
		this.running = false;
		this.startError = undefined;
	}
}
