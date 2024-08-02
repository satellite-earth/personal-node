import debug, { Debugger } from 'debug';

if (!process.env.DEBUG) debug.enable('satellite,satellite:*');

type Listener = (logger: Debugger, ...args: any[]) => void;
const listeners = new Set<Listener>();

export function addListener(listener: Listener) {
	listeners.add(listener);
}
export function removeListener(listener: Listener) {
	listeners.delete(listener);
}

const logger = debug('satellite');

// listen for logs
logger.log = function (this: Debugger, ...args: any[]) {
	for (const listener of listeners) {
		listener(this, ...args);
	}
	console.log.apply(this, args);
};

export { logger };
