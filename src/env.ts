/**
 * This file is responsible for taking any environment variable that is needed and mapping it to constants
 * If necessary it should also perform and parsing or error checking on the environment variables
 */

import 'dotenv/config.js';
import { randomBytes } from 'crypto';

const OWNER_PUBKEY = process.env.OWNER_PUBKEY;
const USE_PREBUILT_SQLITE_BINDINGS = typeof process.env.USE_PREBUILT_SQLITE_BINDINGS !== 'undefined';
const DATA_PATH = process.env.DATA_PATH || './data';
const PORT = parseInt(process.env.PORT ?? '') || 2012;

// get AUTH token or generate a random open at startup
const AUTH = process.env.AUTH || randomBytes(16).toString('hex');

export const REDIRECT_APP_URL = process.env.REDIRECT_APP_URL;

export { USE_PREBUILT_SQLITE_BINDINGS, DATA_PATH, PORT, AUTH, OWNER_PUBKEY };
