/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Subscriptions. Wake, growth, retention and heap facts are exact counters or same-run ratios;
// the 4k/1k one-write scale guards the index against a per-subscriber scan regression.
export default [
    {
        id: 'subscribe/reads-copy@1k', improvement: 'R6-04', scenario: 'subscribe/reads-copy', args: [1000, 9],
        gates: [
            {metric: 'callerMutationWakes', equals: 0}, {metric: 'grownReadsWake', equals: 1},
            {metric: 'frozenReadsWake', equals: 1}, {metric: 'transferWakes', equals: 1},
        ],
    },
    {
        id: 'subscribe/reads-copy@4k', improvement: 'R6-04', scenario: 'subscribe/reads-copy', args: [4000, 9],
        gates: [
            {metric: 'callerMutationWakes', equals: 0}, {metric: 'grownReadsWake', equals: 1},
            {metric: 'transferWakes', equals: 1},
            {metric: 'transferBytes', over: 'publicBytes', max: 0.95},
        ],
    },
    {
        id: 'subscribe/subscriber-ids@1k', improvement: 'R7-04', scenario: 'subscribe/subscriber-ids', args: [1000, 9],
        gates: [
            {metric: 'protoDelivered', equals: 1}, {metric: 'protoWakesAfterUnsubscribe', equals: 0},
            {metric: 'ctorDelivered', equals: 1}, {metric: 'ctorWakesAfterUnsubscribe', equals: 0},
            {metric: 'protoIdFiled', equals: true}, {metric: 'protoSlotIsolated', equals: true},
            {metric: 'protoIdGone', equals: true}, {metric: 'protoSlotClean', equals: true},
        ],
    },
    {
        id: 'subscribe/match-precision@100', improvement: 'JS-R16-02', scenario: 'subscribe/match-precision', args: [100, 9],
        gates: [
            {metric: 'replaceWakes', equals: 1}, {metric: 'setDataWakes', equals: 1},
            {metric: 'restoreWakes', equals: 1}, {metric: 'unmatchedWakes', equals: 0},
            {metric: 'publications', equals: 3},
            {metric: 'indexOneWakes', equals: 1}, {metric: 'indexParentWakes', equals: 1},
            {metric: 'droppedSiblingWakes', equals: 0}, {metric: 'keptSiblingWakes', equals: 1},
            {metric: 'multiWakes', equals: 50},
        ],
    },
    {
        id: 'subscribe/match-precision@1k', improvement: 'JS-R16-02', scenario: 'subscribe/match-precision', args: [1000, 9],
        gates: [
            {metric: 'replaceWakes', equals: 1}, {metric: 'setDataWakes', equals: 1},
            {metric: 'restoreWakes', equals: 1}, {metric: 'unmatchedWakes', equals: 0},
            {metric: 'publications', equals: 3},
            {metric: 'indexOneWakes', equals: 1}, {metric: 'indexParentWakes', equals: 1},
            {metric: 'droppedSiblingWakes', equals: 0}, {metric: 'keptSiblingWakes', equals: 1},
            {metric: 'multiWakes', equals: 500},
            {metric: 'heapBytesPerSubscriber', max: 1500},
        ],
    },
    {
        id: 'subscribe/match-precision@4k', improvement: 'JS-R16-02', scenario: 'subscribe/match-precision', args: [4000, 9],
        gates: [
            {metric: 'replaceWakes', equals: 1}, {metric: 'setDataWakes', equals: 1},
            {metric: 'restoreWakes', equals: 1}, {metric: 'unmatchedWakes', equals: 0},
            {metric: 'publications', equals: 3},
            {metric: 'indexOneWakes', equals: 1}, {metric: 'indexParentWakes', equals: 1},
            {metric: 'droppedSiblingWakes', equals: 0}, {metric: 'keptSiblingWakes', equals: 1},
            {metric: 'multiWakes', equals: 500},
            {metric: 'heapBytesPerSubscriber', max: 1500},
            {metric: 'oneWriteMs', scale: {from: 'subscribe/match-precision@1k'}, max: 3},
        ],
    },
    // PG-C1
    // JS-R15-04 only: filing counters do not prove JS-R15-05 bucket/cache allocations.
    // Pre-fix build: worktrees/bench-dist/868a74f30925/esm-prod.
    {
        id: 'subscribe/refile-delta@1k', improvement: 'JS-R15-04', scenario: 'subscribe/pg-c1/refile-delta', args: [1000],
        gates: [
            {metric: 'exactFiles', equals: 1}, {metric: 'ancestorFiles', equals: 2},
            {metric: 'exactUnfiles', equals: 0}, {metric: 'ancestorUnfiles', equals: 0},
            {metric: 'unchangedExactTouches', equals: 0}, {metric: 'filingWork', equals: 3},
        ],
    },
    {
        id: 'subscribe/refile-delta@4k', improvement: 'JS-R15-04', scenario: 'subscribe/pg-c1/refile-delta', args: [4000],
        gates: [
            {metric: 'exactFiles', equals: 1}, {metric: 'ancestorFiles', equals: 2},
            {metric: 'exactUnfiles', equals: 0}, {metric: 'ancestorUnfiles', equals: 0},
            {metric: 'unchangedExactTouches', equals: 0}, {metric: 'filingWork', equals: 3},
            {metric: 'exactFiles', scale: {from: 'subscribe/refile-delta@1k'}, max: 1.1},
            {metric: 'ancestorFiles', scale: {from: 'subscribe/refile-delta@1k'}, max: 1.1},
            {metric: 'filingWork', scale: {from: 'subscribe/refile-delta@1k'}, max: 1.1},
        ],
    },
    ...[1000, 4000].map(paths => ({
        id: `subscribe/refile-delta-control@${paths === 1000 ? '1k' : '4k'}`,
        improvement: 'control', scenario: 'subscribe/pg-c1/refile-delta', args: [paths],
        gates: [
            {metric: 'idleWork', equals: 0},
            {metric: 'removalExactUnfiles', min: 1}, {metric: 'removalAncestorUnfiles', min: 2},
            {metric: 'addedWakes', equals: 1}, {metric: 'keptWakes', equals: 1},
            {metric: 'removedWakes', equals: 0}, {metric: 'removalKeptWakes', equals: 1},
            {metric: 'unsubscribedWakes', equals: 0}, {metric: 'done', equals: true},
        ],
    })),
    // PG-HEAP
    // 868a74f30925: bucket objects/cache records per subscriber 6/3 -> 0/0; controls pass.
    {
        id: 'subscribe/three-path-buckets@4k', improvement: 'JS-R15-05', scenario: 'subscribe/pg-heap/three-path-buckets',
        gates: [{metric: 'exactBucketObjects', equals: 0}, {metric: 'ancestorBucketObjects', equals: 0},
            {metric: 'bucketsPerSubscriber', equals: 0}, {metric: 'cacheRecordsPerSubscriber', equals: 0}],
    },
    {
        id: 'subscribe/three-path-buckets@4k-control', improvement: 'control', scenario: 'subscribe/pg-heap/three-path-buckets',
        gates: [{metric: 'positiveBuckets', min: 1}, {metric: 'positiveExactBuckets', min: 1},
            {metric: 'positiveAncestorBuckets', min: 1}, {metric: 'ancestorPositiveWakes', equals: 3},
            {metric: 'ancestorPositiveDistinct', equals: true}, {metric: 'positiveCacheRecords', equals: 1},
            {metric: 'idleBuckets', equals: 0}, {metric: 'idleExactBuckets', equals: 0},
            {metric: 'idleAncestorBuckets', equals: 0}, {metric: 'idleCacheRecords', equals: 0}, {metric: 'done', equals: true}],
    },
    // R6-04 no-added-copy control: no historical internal-copy separation established.
    // Candidate and 523d6a04a5f5: internal/public/intentional-copy counts 0/4000/4000; idle 0.
    // Intentional copied internal handover must be detected, alongside public-copy sensitivity.
    {
        id: 'subscribe/reads-copy@4k-copy-control', improvement: 'control', scenario: 'subscribe/pg-heap/reads-copy',
        gates: [{metric: 'internalCopies', equals: 0}, {metric: 'publicCopies', equals: 4000},
            {metric: 'negativeCopies', equals: 4000}, {metric: 'negativeRejected', equals: true},
            {metric: 'idleCopies', equals: 0}, {metric: 'transferWakes', equals: 1},
            {metric: 'unsubscribedWakes', equals: 0}, {metric: 'done', equals: true}],
    },
]
