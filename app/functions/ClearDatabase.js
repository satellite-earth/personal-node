export default function ClearDatabase(app) {
	app.database.clear();

	app.control.updateDatabaseStatus();
}
