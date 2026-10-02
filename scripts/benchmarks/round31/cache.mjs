import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {basename, isAbsolute, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const distributionRoot = process.argv[2];
if (!distributionRoot || !isAbsolute(distributionRoot)) {
    throw new Error('Usage: node scripts/benchmarks/round31/cache.mjs <absolute-cjs-prod-or-esm-prod-root>');
}
const dist = resolve(distributionRoot);
if (!['cjs-prod', 'esm-prod'].includes(basename(dist))) {
    throw new Error('The benchmark argument must be the production distribution root cjs-prod or esm-prod');
}
const require = createRequire(import.meta.url);
const load = async (modulePath) => {
    const cjs = resolve(dist, `${modulePath}.js`);
    if (existsSync(cjs)) return require(cjs);
    const esm = resolve(dist, `${modulePath}.mjs`);
    if (!existsSync(esm)) throw new Error(`Missing production module under ${dist}: ${modulePath}`);
    return import(pathToFileURL(esm).href);
};

const [{ResourceCache}, {EResourceStatus}] = await Promise.all([
    load('Carburetor/Resource/Cache/ResourceCache'),
    load('Carburetor/Models/Enums/EResourceStatus'),
]);

const ready = (rowId) => ({
    status: EResourceStatus.Success,
    data: {rowId, detail: {value: rowId}},
    error: undefined,
    updatedAt: 1,
    refreshing: false,
    invalidated: false,
    failed: false,
});

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const prepareRemoval = (operation, count) => {
    let loaderCalls = 0;
    const cache = new ResourceCache((key) => {
        loaderCalls++;
        if (operation === 'mixed-active-readonly') return new Promise(() => undefined);
        return Promise.resolve({key});
    }, {ttl: Infinity, maxEntries: Infinity});
    const entries = Object.create(null);
    const keys = [];
    for (let index = 0; index < count; index++) {
        const key = cache.keyOf(`row-${index}`);
        keys.push(key);
        Object.defineProperty(entries, key, {
            value: ready(index), enumerable: true, writable: true,
            configurable: operation === 'settled-writable' || (operation === 'mixed-active-readonly' && index === 0),
        });
    }
    cache.setData({entries});

    let activeRequest;
    if (operation === 'mixed-active-readonly') {
        activeRequest = cache.refresh('row-0');
        void activeRequest.catch(() => undefined);
    }

    let subscriberCalls = 0;
    const subscription = cache.subscribe(() => { subscriberCalls++; });
    return {cache, keys, loaderCalls: () => loaderCalls, subscriberCalls: () => subscriberCalls,
        subscription, activeRequest};
};

const removeOnce = (operation, count, instrument) => {
    const state = prepareRemoval(operation, count);
    const beforeVersion = state.cache.getVersion();
    const originalOwnKeys = Reflect.ownKeys;
    let rootOwnershipPasses = 0;
    let entryVisits = 0;
    let rowVisits = 0;
    if (instrument) {
        Reflect.ownKeys = (target) => {
            if (Object.hasOwn(target, 'entries')) rootOwnershipPasses++;
            if (Object.hasOwn(target, 'status') && Object.hasOwn(target, 'data')) entryVisits++;
            if (Object.hasOwn(target, 'rowId')) rowVisits++;
            return originalOwnKeys(target);
        };
    }

    const started = performance.now();
    try {
        state.cache.forgetAll();
    } finally {
        if (instrument) Reflect.ownKeys = originalOwnKeys;
    }
    const elapsedMs = performance.now() - started;
    const remainingEntries = Object.keys(state.cache.getData().entries).length;
    const publicationDelta = state.cache.getVersion() - beforeVersion;
    const subscriberCalls = state.subscriberCalls();
    const loaderCalls = state.loaderCalls();
    state.cache.unsubscribe(state.subscription);
    return {instrumentedElapsedMs: elapsedMs, rootOwnershipPasses, entryVisits, rowVisits, remainingEntries,
        publicationDelta,
        subscriberCalls, loaderCalls};
};

const runRemoval = (operation, count, samples) => {
    const metrics = removeOnce(operation, count, true);
    const timings = [];
    for (let sample = 0; sample < samples; sample++) {
        timings.push(removeOnce(operation, count, false).instrumentedElapsedMs);
    }
    console.log(JSON.stringify({kind: 'forgetAll', operation, count, ...metrics,
        medianElapsedMs: Number(median(timings).toFixed(3)), timingSamples: samples}));
};

const memoCycle = (count, keyCacheSize) => {
    const options = {ttl: Infinity, maxEntries: Infinity};
    if (keyCacheSize !== undefined) options.keyCacheSize = keyCacheSize;
    const cache = new ResourceCache(() => Promise.resolve(undefined), options);
    for (let index = 0; index < count; index++) {
        const actualKey = cache.resolve(index).key;
        if (actualKey !== String(index)) throw new Error(`Unexpected key for ${index}: ${actualKey}`);
    }

    const originalStringify = JSON.stringify;
    let stringifyCalls = 0;
    let checksum = 0;
    let elapsedMs = 0;
    JSON.stringify = (...args) => {
        stringifyCalls++;
        return originalStringify.apply(JSON, args);
    };
    try {
        const started = performance.now();
        for (let index = 0; index < count; index++) {
            const actualKey = cache.resolve(index).key;
            if (actualKey !== String(index)) throw new Error(`Unexpected key for ${index}: ${actualKey}`);
            checksum += Number(actualKey);
        }
        elapsedMs = performance.now() - started;
    } finally {
        JSON.stringify = originalStringify;
    }
    console.log(JSON.stringify({kind: 'primitiveMemoCycle', count, keyCacheSize: keyCacheSize ?? null,
        secondPassStringifyCalls: stringifyCalls, checksum, elapsedMs: Number(elapsedMs.toFixed(3))}));
};

const hotCold = () => {
    const capacity = 4096;
    const hotKeys = Array.from({length: 8}, (_value, index) => `hot-${index}`);
    const cache = new ResourceCache(() => Promise.resolve(undefined), {ttl: Infinity, maxEntries: Infinity});
    const hotResults = hotKeys.map((key) => cache.keyOf(key));
    for (let index = 0; index < capacity - hotKeys.length; index++) cache.keyOf(`cold-${index}`);
    hotKeys.forEach((key) => cache.keyOf(key));

    const originalStringify = JSON.stringify;
    let stringifyCalls = 0;
    JSON.stringify = (...args) => {
        stringifyCalls++;
        return originalStringify.apply(JSON, args);
    };
    let elapsedMs = 0;
    const started = performance.now();
    try {
        cache.keyOf('crossing-cold-key');
        hotKeys.forEach((key, index) => {
            if (cache.keyOf(key) !== hotResults[index]) throw new Error(`Hot key changed: ${key}`);
        });
        elapsedMs = performance.now() - started;
    } finally {
        JSON.stringify = originalStringify;
    }
    console.log(JSON.stringify({kind: 'primitiveMemoHotCold', capacity, hotKeys: hotKeys.length,
        coldMisses: 1, hotRehits: hotKeys.length, stringifyCalls, elapsedMs: Number(elapsedMs.toFixed(3))}));
};

console.log(JSON.stringify({kind: 'distribution', root: dist}));
// A mixed active request intentionally measures the reentry-safe fallback with locked siblings.
// The 4097 default sweep may miss every time; the explicitly-budgeted 8192 sweep tests that tradeoff.
for (const count of [32, 128]) {
    for (const operation of ['settled-readonly', 'settled-writable', 'mixed-active-readonly']) {
        runRemoval(operation, count, 5);
    }
}
memoCycle(4096);
memoCycle(4097);
hotCold();
memoCycle(8192, 8192);
