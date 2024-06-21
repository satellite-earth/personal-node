/**
 * This file is responsible for taking any environment variable that is needed and mapping it to constants
 * If necessary it should also perform and parsing or error checking on the environment variables
 */

import 'dotenv/config.js';
import { randomBytes } from 'crypto';

export const OWNER_PUBKEY = process.env.OWNER_PUBKEY;
export const PUBLIC_ADDRESS = process.env.PUBLIC_ADDRESS;
export const USE_PREBUILT_SQLITE_BINDINGS = typeof process.env.USE_PREBUILT_SQLITE_BINDINGS !== 'undefined';
export const DATA_PATH = process.env.DATA_PATH || './data';
export const PORT = parseInt(process.env.PORT ?? '') || 2012;

// get AUTH token or generate a random open at startup
export const AUTH = process.env.AUTH || randomBytes(16).toString('hex');

export const REDIRECT_APP_URL = process.env.REDIRECT_APP_URL;

export const BOOTSTRAP_RELAYS = process.env.BOOTSTRAP_RELAYS
	? process.env.BOOTSTRAP_RELAYS.split(',')
	: ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.nostr.band'];

export const COMMON_CONTACT_RELAYS = process.env.COMMON_CONTACT_RELAYS
	? process.env.COMMON_CONTACT_RELAYS.split(',')
	: ['wss://purplepag.es', 'wss://user.kindpag.es', 'wss://relay.nos.social'];
