import {performance} from 'node:perf_hooks';
import {Session} from 'node:inspector';
import {resolve} from 'node:path';
import {loadSource} from './cacheViewSource.mjs';

const {cache: {ResourceCache}, status: {EResourceStatus}} = await loadSource(resolve(process.cwd()), {
    cache: 'lib/src/Carburetor/Resource/Cache/ResourceCache.ts',
    status: 'lib/src/Carburetor/Models/Enums/EResourceStatus.ts',
});
const label = process.argv[2] || 'current';
const sampleCount = 9;
const profileRounds = 20;
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const ready = (index) => ({
    status: EResourceStatus.Success, data: {index}, error: undefined, updatedAt: 1,
    refreshing: false, invalidated: false, failed: false,
});
const prepare = (count, operation) => {
    const cache = new ResourceCache(() => Promise.resolve(undefined), {ttl: Infinity, maxEntries: Infinity});
    const keys = Array.from({length: count}, (_, index) => cache.keyOf(index));
    const entries = Object.fromEntries(keys.map((key, index) => [key, ready(index)]));

    cache.setData({entries});

    const previous = keys.map((key) => cache.getEntryByKey(key));
    const replacement = operation === 'same-root' ? cache.getData()
        : operation === 'new-root' ? {entries}
            : {entries: {...entries, [keys[0]]: {...entries[keys[0]], data: {index: -1}}}};

    return {cache, keys, previous, replacement};
};
const replaceAndRead = (state) => {
    const version = state.cache.getVersion();
    const started = performance.now();

    state.cache.setData(state.replacement);

    const replacementMs = performance.now() - started;
    const views = state.keys.map((key) => state.cache.getEntryByKey(key));
    const elapsedMs = performance.now() - started;
    const changedIdentities = views.filter((view, index) => view !== state.previous[index]).length;

    return {replacementMs, readMs: elapsedMs - replacementMs, elapsedMs, changedIdentities,
        versionDelta: state.cache.getVersion() - version};
};
const session = new Session();

session.connect();

const post = (method, params = {}) => new Promise((done, fail) => {
    session.post(method, params, (error, result) => error ? fail(error) : done(result));
});
const sampledBytes = (node) => node.selfSize + node.children.reduce((sum, child) => sum + sampledBytes(child), 0);

try {
    for (const count of [100, 1000, 4000]) {
        for (const operation of ['same-root', 'new-root', 'one-changed']) {
            for (let round = 0; round < 5; round++) {
                replaceAndRead(prepare(count, operation));
            }

            const samples = [];

            for (let round = 0; round < sampleCount; round++) {
                const state = prepare(count, operation);

                global.gc?.();

                const heapBefore = process.memoryUsage().heapUsed;
                const result = replaceAndRead(state);
                const uncollectedHeapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;

                state.previous = undefined;
                state.replacement = undefined;
                global.gc?.();
                samples.push({...result, uncollectedHeapDeltaBytes,
                    postGcRetainedHeapDeltaBytes: process.memoryUsage().heapUsed - heapBefore});
            }

            const states = Array.from({length: profileRounds}, () => prepare(count, operation));

            global.gc?.();
            await post('HeapProfiler.startSampling', {samplingInterval: 1024,
                includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true});

            states.forEach(replaceAndRead);

            const {profile} = await post('HeapProfiler.stopSampling');

            console.log(JSON.stringify({label, count, operation, samples: sampleCount,
                changedIdentities: [...new Set(samples.map((sample) => sample.changedIdentities))],
                versionDelta: [...new Set(samples.map((sample) => sample.versionDelta))],
                medianReplacementMs: median(samples.map((sample) => sample.replacementMs)),
                medianReadMs: median(samples.map((sample) => sample.readMs)),
                medianElapsedMs: median(samples.map((sample) => sample.elapsedMs)),
                medianUncollectedHeapDeltaBytes: median(samples.map((sample) => sample.uncollectedHeapDeltaBytes)),
                medianPostGcRetainedHeapDeltaBytes:
                    median(samples.map((sample) => sample.postGcRetainedHeapDeltaBytes)),
                estimatedSampledAllocatedBytesPerOperation: sampledBytes(profile.head) / profileRounds}));
        }
    }
} finally {
    session.disconnect();
}

console.log('Times exclude setup, source bundling and allocation profiling. Sampling estimates all replacement/read '
    + 'allocations, not only views. Heap deltas are not allocation counts; retained deltas drop old views and '
    + 'replacement inputs before forced GC. JIT, GC and sampling noise affect comparisons. No React renders measured.');
