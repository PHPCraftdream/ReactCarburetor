import {Carburetor} from '@react-carburetor/core';

const EVERY_FIELD = '*';

/** Counts the store's notifications; a new reads set is built on every call. */
export const countUpdates = (store: Carburetor<{n: number}>, onUpdate: () => void): string =>
    store.subscribe(onUpdate, {reads: new Set([EVERY_FIELD])});
