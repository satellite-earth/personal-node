import crypto from 'crypto';
import { NostrEvent } from 'nostr-tools';
import { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';

import * as Util from '../lib/util/index.js';
import API from './API.js';
import type App from '../index.js';
import { type Relay } from '../lib/receiver/relay.js';
import { AppConfig } from '../config-manager.js';

export type ControlOptions = {
	controlAuth?: (auth: string) => boolean;
};

export type ControlStatus = {
	listening: boolean;
	relaysConnected: Record<string, boolean>;
	dbCount: number;
	dbSize: number;
};

class Control {
	app: App;
	options: ControlOptions;

	authorizedConnections = new Set<WebSocket>();

	status: ControlStatus = {
		listening: false,
		relaysConnected: {},
		dbCount: 0,
		dbSize: 0,
	};

	api: Record<string, (data: any) => void>;

	_databaseStatusUpdated = 0;
	_databaseStatusPending = false;
	_databaseStatusTimeout?: NodeJS.Timeout;
	_reconnectReceiverPending = false;
	_reconnectReceiver?: NodeJS.Timeout;

	constructor(app: App, options: ControlOptions) {
		this.app = app;

		this.options = options;

		// Actions may be called locally and also
		// by proxy through a control connection
		this.api = API(this);
	}

	action(type: string, data: any) {
		if (!this.api[type]) return;

		let result;

		try {
			result = this.api[type](data);
		} catch (err) {
			console.log('api err', err);
			// TODO dispatch error
		}
	}

	// Set config file state, save to disk,
	// and forward to change to controllers
	setConfig(config?: Partial<AppConfig>) {
		if (!config) return;

		this.app.config.updateConfig(config);

		this.broadcast({
			type: 'config/set',
			data: config,
		});

		this.log({
			text: `[CONFIG] ${Object.keys(config)
				.map((key) => {
					// @ts-expect-error
					return `${key} = ${JSON.stringify(config[key])}`.toUpperCase();
				})
				.join(' | ')}`,
		});
	}

	// Set status flags and forward
	setStatus(data?: Partial<ControlStatus>) {
		if (!data) return;

		this.status = {
			...this.status,
			...data,
		};

		this.broadcast({
			type: 'status/set',
			data,
		});
	}

	handleInserted({ pubkey, kind, content }: NostrEvent) {
		const profile = this.app.graph.getProfile(pubkey);

		const name = profile && profile.name ? profile.name : Util.formatPubkey(pubkey);

		let preview;

		// Preview kinds 1 and 7, truncating at 256 chars
		if (kind === 1 || kind === 7) {
			preview = content.length > 256 ? content.slice(0, 256) : content;
		}

		this.log({
			text: `[EVENT] KIND ${kind} FROM ${name}` + (preview ? ` "${preview}"` : ''),
		});

		if (this._databaseStatusPending) return;

		const statusDelta = this._databaseStatusUpdated + 1000 - Date.now();

		// If it's been at least one second since the last
		// database status broadcast, update immediately
		if (statusDelta <= 0) {
			this.updateDatabaseStatus();
		} else {
			// Otherwise set to fire at t + delta

			this._databaseStatusPending = true;

			this._databaseStatusTimeout = setTimeout(() => {
				this.updateDatabaseStatus();
			}, statusDelta);
		}
	}

	updateDatabaseStatus() {
		this._databaseStatusPending = false;
		this._databaseStatusUpdated = Date.now();

		const dbSize = this.app.database.size();
		const dbCount = this.app.database.count();

		// Only broadcast db metrics if value(s) changed
		if (dbSize === this.status.dbSize && dbCount === this.status.dbCount) {
			return;
		}

		this.setStatus({
			dbCount,
			dbSize,
		});
	}

	handleRelayStatus({ status, relay }: { status: 'connected' | 'disconnected'; relay: Relay }) {
		if (!relay) return;

		// When remote connected status changes to disconnected,
		// stop listening and reconnect only the persistent data
		// subs after slight delay - this is necessary to prevent
		// memory leaks caused by reopening subs on the ndk instance
		// if (status === 'disconnected' && this.status.listening) {

		// 	this._reconnectReceiverPending = true;

		// 	this.setStatus({ listening: false });

		// 	this._reconnectReceiver = setTimeout(() => {

		// 		this._reconnectReceiverPending = false;

		// 		receiver.unlisten();

		// 		receiver.listen(this.config, {
		// 			reconnect: true
		// 		});

		// 		this.setStatus({ listening: true });

		// 	}, 200);

		// 	return;
		// }

		const currentlyConnected = this.status.relaysConnected[relay.url];

		this.setStatus({
			relaysConnected: {
				...this.status.relaysConnected,
				[relay.url]: status === 'connected',
			},
		});

		if ((!currentlyConnected && status === 'connected') || (status !== 'connected' && currentlyConnected)) {
			this.log({
				text: `[STATUS] REMOTE ${status.toUpperCase()} ${relay.url}`,
			});

			//if (this._reconnectReceiverPending) { return; }

			//if (status === 'disconnected') {

			//if (!this._reconnectReceiverPending && status === 'disconnected') {

			//this._reconnectReceiverPending = true;

			//this._reconnectReceiver = setTimeout(() => {

			//this._reconnectReceiverPending = false;
			// receiver.unlisten();

			// receiver.listen(this.config, {
			// 	reconnect: true
			// });

			//}, 200);
			//}
			//}
		}
	}

	sendToParentProcess(message: any) {
		if (typeof process.send !== 'function') {
			return;
		}

		process.send(message);
	}

	handleConnection(ws: WebSocket, req: IncomingMessage) {
		ws.on('message', (data, isBinary) => {
			this.handleMessage(data as Buffer, ws);
		});

		ws.on('close', () => this.handleDisconnect(ws));
	}
	handleDisconnect(ws: WebSocket) {
		this.authorizedConnections.delete(ws);
	}
	handleMessage(buffer: Buffer, ws: WebSocket) {
		try {
			const data = JSON.parse(buffer.toString());

			if (data[0] === 'CONTROL') {
				this.handleControlMessage(data, ws);
			}
		} catch (err) {
			console.log(err);
		}
	}
	handleControlMessage(message: string[], ws: WebSocket) {
		// Maybe authorize connection - maintain a flag or most recent
		// auth status on each websocket so that config updates can
		// be forwarded to multiple simultaneous control connections.
		// Send client a notice when its auth state changes.
		if (this.options.controlAuth?.(message[1])) {
			this.authorizedConnections.add(ws);
		} else {
			this.authorizedConnections.delete(ws);
			return;
		}

		// Invoke the action, sending response
		// to each active control connection
		this.action(message[2], message[3]);
	}

	attachToServer(wss: WebSocketServer) {
		wss.on('connection', this.handleConnection.bind(this));
	}

	// Broadcast control status to authorized clients
	broadcast(payload: any) {
		for (const ws of this.authorizedConnections) {
			ws.send(JSON.stringify(['CONTROL', payload]));
		}
	}

	// Send log as authorized broadcast
	log(data: any) {
		if (this.app.config.config.logsEnabled) {
			this.broadcast({
				type: 'logs/remote',
				data: {
					id: crypto.randomUUID(),
					...data,
				},
			});
		}
	}

	stop() {
		clearTimeout(this._databaseStatusTimeout);
		clearTimeout(this._reconnectReceiver);

		this._reconnectReceiverPending = false;
		this._databaseStatusPending = false;
	}
}

export default Control;
