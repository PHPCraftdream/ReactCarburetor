/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R31-06 + R30-08: an explicit keyCacheSize is honored and one cold crossing no longer wipes the
// hot set; the repeated pass at or below capacity stays free of re-serialization, while the
// cold pass proves the memo is fed by real JSON.stringify derivation. Args: [mode=cycle|hotcold] [count=4096] [keyCacheSize]
import {emit, loadPath} from '../../harness/lib.mjs';

const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');

const mode = process.argv[2] ?? 'cycle';
const count = Number(process.argv[3] ?? 4096);
const budget = process.argv[4] === undefined ? undefined : Number(process.argv[4]);

const withStringify = fn => {
    const original = JSON.stringify;
    let calls = 0;
    JSON.stringify = (...args) => {
        calls++;
        return original.apply(JSON, args);
    };
    try {
        const value = fn();
        return {calls, value};
    } finally {
        JSON.stringify = original;
    }
};

if (mode === 'cycle') {
    const options = {ttl: Infinity, maxEntries: Infinity};
    if (budget !== undefined) options.keyCacheSize = budget;
    const cache = new ResourceCache(() => Promise.resolve(undefined), options);
    const resolveKey = index => {
        const actual = cache.resolve(index).key;
        if (actual !== String(index)) throw new Error(`unexpected key for ${index}: ${actual}`);
        return actual;
    };
    // Cold pass: every key is derived once through real serialization.
    const cold = withStringify(() => {
        for (let index = 0; index < count; index++) resolveKey(index);
    });
    const pass = withStringify(() => {
        let checksum = 0;
        const started = performance.now();
        for (let index = 0; index < count; index++) {
            checksum += Number(resolveKey(index));
        }
        return {checksum, ms: performance.now() - started};
    });
    emit({coldStringifyCalls: cold.calls, stringifyCalls: pass.calls,
        checksum: pass.value.checksum, cycleMs: pass.value.ms});
} else {
    const capacity = 4096;
    const hotKeys = Array.from({length: 8}, (_, index) => `hot-${index}`);
    const cache = new ResourceCache(() => Promise.resolve(undefined), {ttl: Infinity, maxEntries: Infinity});
    const hotResults = hotKeys.map(key => cache.keyOf(key));
    for (let index = 0; index < capacity - hotKeys.length; index++) cache.keyOf(`cold-${index}`);
    const rehit = () => {
        hotKeys.forEach((key, index) => {
            if (cache.keyOf(key) !== hotResults[index]) throw new Error(`hot key changed: ${key}`);
        });
        return hotKeys.length;
    };
    const warm = withStringify(rehit);
    cache.keyOf('crossing-cold-key');
    const hot = withStringify(rehit);
    emit({warmStringifyCalls: warm.calls, hotStringifyCalls: hot.calls, hotKeysRehit: hot.value});
}
