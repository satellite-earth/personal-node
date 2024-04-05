export default function Shutdown(app) {
	console.log('node shutting down gracefully...');

	app.control.stop();

	app.receiver.stop();

	app.database.stop();

	//process.exit(0);
}
