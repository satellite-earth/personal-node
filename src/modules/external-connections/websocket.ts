import { ClientRequestArgs } from 'http';
import { ClientOptions, WebSocket } from 'ws';

import { agent } from './agent.js';

/** extends the WebSocket class from ws to always use the custom http agent */
export default class TransparentProxyWebSocket extends WebSocket {
	constructor(address: string | URL, options?: ClientOptions | ClientRequestArgs) {
		super(address, { agent, ...options });
	}
}
