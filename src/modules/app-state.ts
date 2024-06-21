import { ReactiveJsonFileSync } from '@satellite-earth/core';
import { WebSubscription } from '@satellite-earth/core/types/control-api/notifications.js';
import { JSONFileSync } from 'lowdb/node';

export type AppStateType = {
	subscriptions: WebSubscription[];
};

const initialState: AppStateType = {
	subscriptions: [],
};

export default class AppState extends ReactiveJsonFileSync<AppStateType> {
	constructor(path: string) {
		super(new JSONFileSync(path), initialState);
	}
}
