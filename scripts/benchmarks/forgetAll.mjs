import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const {ResourceCache} = require('../../dist/cjs/Carburetor/Resource/Cache/ResourceCache.js');
const {EResourceStatus} = require('../../dist/cjs/Carburetor/Models/Enums/EResourceStatus.js');
const {persist} = require('../../dist/cjs/Carburetor/Tooling/persist.js');
const sizes = [100, 1000, 4000];
const configurations = ['none', 'wildcard', 'persist', 'coalesced'];

const entry = (status) => ({
    status,
    data: status === EResourceStatus.Success ? 'value' : undefined,
    error: undefined,
    updatedAt: Date.now(),
    refreshing: false,
    invalidated: false,
    failed: false,
});

const run = async (operation, count, configuration) => {
    const cache = new ResourceCache(() => new Promise(() => undefined), {maxEntries: count + 1});
    const keys = Array.from({length: count}, (_, index) => `key-${index}`);
    let callbacks = 0;
    let storageWrites = 0;
    let dispose = () => undefined;

    if (operation === 'forgetAll') {
        const entries = Object.fromEntries(keys.map((key) => [cache.keyOf(key), entry(EResourceStatus.Success)]));

        cache.setData({entries});
        cache.eviction.setCount(count);
    } else {
        keys.forEach((key) => { void cache.load(key); });
    }

    if (configuration === 'wildcard') {
        const id = cache.subscribe(() => { callbacks++; });

        dispose = () => cache.unsubscribe(id);
    } else if (configuration === 'persist' || configuration === 'coalesced') {
        const storage = {
            getItem: () => null,
            setItem: () => { storageWrites++; },
            removeItem: () => undefined,
        };

        dispose = persist(cache, {key: 'bench', storage, coalesce: configuration === 'coalesced'});
    }

    if (global.gc) {
        global.gc();
    }

    const heapBefore = process.memoryUsage().heapUsed;
    const versionBefore = cache.getVersion();
    const started = performance.now();

    cache[operation]();
    await Promise.resolve();

    const wallMs = performance.now() - started;
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;

    dispose();

    return {operation, count, configuration, versionDelta: cache.getVersion() - versionBefore,
        callbacks, storageWrites, wallMs: Number(wallMs.toFixed(2)), heapDeltaBytes};
};

for (const operation of ['forgetAll', 'abortAll']) {
    for (const count of sizes) {
        for (const configuration of configurations) {
            console.log(JSON.stringify(await run(operation, count, configuration)));
        }
    }
}

console.log('heapDeltaBytes is retained heap change, not allocated bytes; GC and JIT affect it and wallMs.');
