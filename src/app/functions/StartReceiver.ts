import type App from '../index.js';

export default function StartReceiver(app: App) {
	// Listen if not already
	if (!app.control.status.listening) {
		const status = { listening: true };

		// Report status to gui
		app.control.setStatus(status);

		// await receiver.listen(control.config);
		const { owner, pubkeys } = app.config.config;
		app.receiver.listen({
			pubkeys: owner ? [owner, ...pubkeys] : pubkeys,
			relays: app.config.config.relays,
			cacheLevel: app.config.config.cacheLevel,
		});

		// Report status to parent process
		app.control.sendToParentProcess({
			type: 'LISTENER_STATE',
			data: status,
		});

		app.control.log({
			text: '[CONTROL] SATELLITE RECEIVER LISTENING',
		});
	}
}
