/* oxlint-disable carburetor/max-line-length, carburetor/require-tsdoc */
// The development build is the `esm` sibling of the measured production dist; the unpublished-draft
// diagnostic only exists there. The diagnostic is gated by callback identity, not by time.
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {emit, distRoot} from '../../harness/lib.mjs';
import assert from 'node:assert/strict';

// The runner spawns children with NODE_ENV=production; the development build's diagnostics are
// gated on that at import time, so force development before the store module is loaded.
process.env.NODE_ENV = 'development';

const devEntry = resolve(distRoot, '..', 'esm', 'Carburetor', 'Store', 'Carburetor.mjs');
if (!existsSync(devEntry)) throw new Error('no development build at ' + resolve(distRoot, '..', 'esm') + ': build all formats (esm alongside esm-prod)');
const {Carburetor} = await import(pathToFileURL(devEntry).href);
const flush = () => Promise.resolve();

class Counter extends Carburetor {
    /** Initializes a real counter store. */
    constructor() {
        super({n: -1});
    }

    /** Writes one draft value.
     *
     * @param n - next counter
     * @param publish - whether to publish this cycle
     */
    set(n, publish = true) {
        this.draft.n = n;
        if (publish) this.emitUpdate();
    }
}

// Instrumented development-build cycle: subscriber deliveries, queued diagnostic callbacks and
// warnings, mirroring the paired benchmark's identity check.
const store = new Counter();
let deliveries = 0;
const subscription = store.subscribe(() => deliveries++);
const identities = new Set();
let queued = 0;
const originalQueue = globalThis.queueMicrotask;
const originalError = console.error;
let warnings = 0;
globalThis.queueMicrotask = (callback) => {
    queued++;
    identities.add(callback);
    originalQueue(callback);
};
console.error = () => warnings++;
try {
    for (let i = 0; i < 8; i++) {
        store.set(i);
    }
    await flush();
    store.set(8, false);
    await flush();
    store.set(9);
    await flush();
} finally {
    globalThis.queueMicrotask = originalQueue;
    console.error = originalError;
    store.unsubscribe(subscription);
}

assert.strictEqual(store.getData().n, 9);
assert.strictEqual(deliveries, 9);
assert.strictEqual(warnings, 1);
assert.ok(queued >= 1, 'the dev diagnostic never queued a check: the callback-identity gate would be blind');

emit({distinctCallbacks: identities.size, queued, deliveries, warnings, finalN: store.getData().n, done: true});
