/**
 * This file is responsible for taking any environment variable that is needed and mapping it to constants
 * If nessisary it should also perform and parsing or error checking on the environment variables
 */

const NATIVE_BINDINGS_PATH = process.env.NATIVE_BINDINGS_PATH;
const DATA_PATH = process.env.DATA_PATH || './data';
const PORT = parseInt(process.env.PORT) || 2012;
const HTTP_PORT = parseInt(process.env.HTTP_PORT) || 2011;

// get AUTH token or generate a random open at startup
const AUTH =
	process.env.AUTH || require('crypto').randomBytes(16).toString('hex');

export { NATIVE_BINDINGS_PATH, DATA_PATH, PORT, HTTP_PORT, AUTH };
