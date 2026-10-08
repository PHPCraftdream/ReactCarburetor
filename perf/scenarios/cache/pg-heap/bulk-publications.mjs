/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R8-03/R9-04: synchronous persistence exposes every publication, without microtask coalescing.
import {emit, loadPath} from '../../../harness/lib.mjs';

const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {EResourceStatus} = await loadPath('Carburetor/Models/Enums/EResourceStatus.mjs');
const {persist} = await loadPath('Carburetor/Tooling/persist.mjs');
const count = Number(process.argv[2] ?? 4000);
const operation = process.argv[3] ?? 'forget';
const ready = index => ({
    status: EResourceStatus.Success, data: {index}, error: undefined, updatedAt: 1,
    refreshing: false, invalidated: false, failed: false,
});
const signals = [];
let loaderCalls = 0;
const cache = new ResourceCache((_args, signal) => {
    loaderCalls++;
    signals.push(signal);
    return new Promise(() => undefined);
}, {ttl: Infinity, maxEntries: Infinity});
const keys = Array.from({length: count}, (_, index) => cache.keyOf(index));
if (operation === 'abort') {
    for (let index = 0; index < count; index++) void cache.load(index).catch(() => undefined);
} else {
    cache.setData({entries: Object.fromEntries(keys.map((key, index) => [key, ready(index)]))});
}
let writes = 0;
let callbacks = 0;
let lastStored;
const dispose = persist(cache, {
    key: 'perf-pg-heap', coalesce: false,
    storage: {
        getItem: () => null, removeItem: () => undefined,
        setItem: (_key, value) => { writes++; lastStored = value; },
    },
});
const subscription = cache.subscribe(() => { callbacks++; });
const window = action => {
    const version = cache.getVersion();
    const beforeWrites = writes;
    const beforeCallbacks = callbacks;
    action();
    return {version: cache.getVersion() - version, writes: writes - beforeWrites, callbacks: callbacks - beforeCallbacks};
};
let idle;
let positive;
let bulk;
let repeat;
let remaining;
let abortedSignals;
let stateCorrect;
let storedCorrect;
try {
    idle = window(() => { cache.getData(); });
    // Prepare one additional key outside the measured positive operation.
    if (operation === 'abort') {
        void cache.load('positive').catch(() => undefined);
    } else {
        cache.setData({entries: {...cache.getData().entries, [cache.keyOf('positive')]: ready(-1)}});
    }
    // Single-key operations exercise the same public publication and storage probes.
    positive = window(() => {
        if (operation === 'abort') cache.abort('positive');
        else cache.forget('positive');
    });
    const started = performance.now();
    bulk = window(() => {
        if (operation === 'abort') cache.abortAll();
        else cache.forgetAll();
    });
    bulk.ms = performance.now() - started;
    const entries = cache.getData().entries;
    remaining = Object.keys(entries).length;
    abortedSignals = signals.filter(signal => signal.aborted).length;
    stateCorrect = operation === 'abort'
        ? keys.every(key => entries[key]?.status === EResourceStatus.Idle && !entries[key].refreshing)
        : remaining === 0;
    const stored = JSON.parse(lastStored);
    storedCorrect = JSON.stringify(stored) === JSON.stringify(cache.getData());
    repeat = window(() => {
        if (operation === 'abort') cache.abortAll();
        else cache.forgetAll();
    });
} finally {
    dispose();
    cache.unsubscribe(subscription);
}
emit({
    persistForgetWrites: operation === 'forget' ? bulk.writes : 0,
    versionDeltaAbort: operation === 'abort' ? bulk.version : 0,
    storageWritesAbort: operation === 'abort' ? bulk.writes : 0,
    publicationDelta: bulk.version, subscriberCalls: bulk.callbacks, bulkMs: bulk.ms,
    positiveWrites: positive.writes, positiveVersion: positive.version, positiveCallbacks: positive.callbacks,
    idleWrites: idle.writes, idleVersion: idle.version, idleCallbacks: idle.callbacks,
    repeatWrites: repeat.writes, repeatVersion: repeat.version, repeatCallbacks: repeat.callbacks,
    remainingEntries: remaining, abortedSignals, loaderCalls,
    done: stateCorrect && storedCorrect,
});
