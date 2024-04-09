import type App from '../index.js';

export default function ClearDatabase(app: App) {
	app.database.clear();

	app.control.updateDatabaseStatus();
}
