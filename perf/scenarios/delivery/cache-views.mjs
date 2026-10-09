/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R11-07: a cache view keeps identity while nothing read changed (Object.is on data — NaN
// included) and a signed-zero change is still visible. Args: [reads=30000] [samples=7]
import {emit, loadPath, median, call} from '../../harness/lib.mjs';

const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {EResourceStatus} = await loadPath('Carburetor/Models/Enums/EResourceStatus.mjs');

const reads = Number(process.argv[2] ?? 30000);
const samples = Number(process.argv[3] ?? 7);
const entry = data => ({
    status: EResourceStatus.Success, data, error: undefined, updatedAt: 100,
    refreshing: false, invalidated: false, failed: false,
});

const times = [];
let identities = 0;
let nanPreserved = false;
for (let round = 0; round < samples; round++) {
    const cache = new ResourceCache(async () => NaN, {ttl: Infinity});
    const key = call(cache, 'keyOf', 'a');
    cache.setData({entries: {[key]: entry(NaN)}});
    let previous = cache.getEntry('a');
    let count = 1;
    const start = performance.now();
    for (let i = 0; i < reads; i++) {
        const view = cache.resolve === undefined
            ? cache.getEntry('a')
            : (i % 2 === 0 ? cache.getEntry('a') : cache.resolve('a').view);
        if (view !== previous) {
            count++;
        }
        previous = view;
    }
    times.push(performance.now() - start);
    identities = count;
    nanPreserved = Number.isNaN(previous.data);
}

// A signed-zero change must replace the view (an == comparator would keep it).
const zero = new ResourceCache(async () => 0, {ttl: Infinity});
const zeroKey = call(zero, 'keyOf', 'z');
zero.setData({entries: {[zeroKey]: entry(0)}});
const plusView = zero.getEntry('z');
zero.setData({entries: {[zeroKey]: entry(-0)}});
const minusView = zero.getEntry('z');
const zeroChangeVisible = minusView !== plusView && Object.is(minusView.data, -0);
emit({viewIdentities: identities, identityMs: median(times), nanPreserved, zeroChangeVisible});
