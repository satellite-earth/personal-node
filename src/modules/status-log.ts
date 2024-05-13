import EventEmitter from 'events';

type EventMap = {
	line: [string];
	clear: [];
};

export default class StatusLog extends EventEmitter<EventMap> {
	lines: string[] = [];

	log(...args: any[]) {
		const line = Array.from(args)
			.map((e) => String(e))
			.join(' ');
		this.lines.unshift(line);

		this.emit('line', line);
	}

	clear() {
		this.lines = [];
		this.emit('clear');
	}
}
