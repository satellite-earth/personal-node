import express from 'express';
import Cors from 'cors';

import router from './routes.js';

export default function createExpressServer(app) {
	const server = express();

	server.use(Cors());

	server.use((req, res, next) => {
		// if (req.app === null) {
		// 	next();
		// }

		req.app = typeof app === 'function' ? app(req, res, next) : app;

		// if (req.app) {

		// }

		next();
	});

	server.use((req, res, next) => {
		// TODO handle the NIP-11 business

		next();
	});

	server.use(router);

	return server;
}
