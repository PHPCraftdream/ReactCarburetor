/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R15-05: three disjoint depth-two paths per reader, no shared ancestor buckets.
import {emit, loadPath} from '../../../harness/lib.mjs';
const {SubscriberIndex} = await loadPath('Carburetor/Store/Paths/SubscriberIndex.mjs');
const index = new SubscriberIndex();
const reads = Array.from({length: 4000}, (_, i) => new Set([`a${i}.x`, `b${i}.x`, `c${i}.x`]));
const originalSet = Map.prototype.set;
// Observe actual index-map writes, not just register's dynamic extent: current builds
// file ancestors through registerBranch; 868a74f30925 uses register for both maps.
// Map.prototype is reachable instrumentation; nested branch-count Maps and readsById
// are not bucket maps, so their writes must not inflate or double-count this metric.
const exact = index.exact;
const branch = index.branch;
if (!(exact instanceof Map) || !(branch instanceof Map) || exact === branch) {
    throw new Error('SubscriberIndex exact/branch maps unavailable; bucket counter would be blind');
}
let active;
Map.prototype.set = function (key, value) {
    if (active) {
        if (value !== null && typeof value === 'object') {
            if (this === exact) { active.exactBucketObjects++; active.bucketObjects++; }
            else if (this === branch) { active.ancestorBucketObjects++; active.bucketObjects++; }
        }
        if (Array.isArray(value)) active.ancestorCacheRecords++;
    }
    return originalSet.call(this, key, value);
};
const window = fn => {
    const counters = {exactBucketObjects: 0, ancestorBucketObjects: 0, bucketObjects: 0, ancestorCacheRecords: 0};
    active = counters;
    try { fn(); } finally { active = undefined; }
    return counters;
};
let measured;
let idle;
let positive;
let ancestorPositive;
let cachePositive;
let ancestorPositiveWakes;
let ancestorPositiveDistinct;
let done;
try {
    idle = window(() => {});
    measured = window(() => reads.forEach((set, i) => index.add('s' + i, set)));
    positive = window(() => {
        index.add('shared', new Set(['a0.x']));
        index.add('cold', new Set(['positive.x']));
    });
    // Distinct ids and exact paths share only an ancestor. The second id promotes the
    // current branch's bare string to a Map; the baseline creates its equivalent Set.
    // A third id exercises nested Map writes without counting those as new buckets.
    ancestorPositive = window(() => {
        for (let i = 0; i < 3; i++) index.add('ancestor-positive-' + i, new Set(['ancestor-positive.leaf' + i]));
    });
    const ancestorMatches = index.match(new Set(['ancestor-positive']));
    ancestorPositiveWakes = ancestorMatches.size;
    ancestorPositiveDistinct = [0, 1, 2].every(i => {
        const matches = index.match(new Set(['ancestor-positive.leaf' + i]));
        return ancestorMatches.has('ancestor-positive-' + i) && matches.size === 1 && matches.has('ancestor-positive-' + i);
    });
    cachePositive = window(() => new Map().set('a0.x', ['a0']));
    done = index.match(new Set(['a0.x'])).has('s0') && index.match(new Set(['c3999.x'])).has('s3999');
    index.remove('s3999');
    done &&= !index.match(new Set(['c3999.x'])).has('s3999');
} finally {
    Map.prototype.set = originalSet;
}
emit({...measured, bucketsPerSubscriber: measured.bucketObjects / 4000,
    exactBucketsPerSubscriber: measured.exactBucketObjects / 4000,
    ancestorBucketsPerSubscriber: measured.ancestorBucketObjects / 4000,
    cacheRecordsPerSubscriber: measured.ancestorCacheRecords / 4000,
    positiveBuckets: positive.bucketObjects, positiveExactBuckets: positive.exactBucketObjects,
    positiveAncestorBuckets: ancestorPositive.ancestorBucketObjects,
    ancestorPositiveExactBuckets: ancestorPositive.exactBucketObjects,
    ancestorPositiveWakes, ancestorPositiveDistinct,
    positiveCacheRecords: cachePositive.ancestorCacheRecords,
    idleBuckets: idle.bucketObjects, idleExactBuckets: idle.exactBucketObjects,
    idleAncestorBuckets: idle.ancestorBucketObjects, idleCacheRecords: idle.ancestorCacheRecords, done});
