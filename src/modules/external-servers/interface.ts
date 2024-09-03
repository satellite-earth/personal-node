import { AddressInfo } from 'net';
import App from '../../app/index.js';

export interface IExternalServer {
	app: App;

	running: boolean;
	startError?: Error;

	addresses?: string[];
	start(address: AddressInfo): Promise<void>;
	stop(): Promise<void>;
}
