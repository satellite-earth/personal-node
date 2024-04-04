import * as Util from '../lib/util/index.js';

export default function ExportDatabase(app, params) {
	const events = app.eventStore.getEventsForFilters(params.filters || [{}]);

	return Util.writeJsonl(events, {
		outputPath: params.path,
		outputName: params.name,
		compress: true,
	});

	//return new Promise((resolve, reject) => {

	// const writableStream = fs.createWriteStream(path.join(params.path, `${params.name}.jsonl`));

	// const transform = new Transform({
	//   transform: (json, encoding, callback) => {
	//     callback(null, json);
	//   }
	// });

	// const indexf = events.length - 1;

	// transform.pipe(writableStream);

	// events.forEach((event, index) => {
	//   transform.write(JSON.stringify(event) + (index === indexf ? '' : '\n'));
	// });

	// transform.end();

	// writableStream.on('finish', () => {
	//   resolve();
	// });

	// writableStream.on('error', (err) => {
	//   reject();
	// });

	//});
}
