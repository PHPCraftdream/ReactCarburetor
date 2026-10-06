/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Store. Ratios inside one run and row-wrap counters are machine independent; the R32-08
// Object.create counter separates the builds (20001 pre-fix, 0 now) with its control gate.
export default [
    {
        id: 'store/restore-one-leaf@1k', improvement: 'R34-04', scenario: 'store/restore-one-leaf', args: [1000, 9],
        gates: [
            {metric: 'restoreRowWraps', equals: 1}, {metric: 'readRowWraps', equals: 1},
            {metric: 'restoreMs', over: 'snapshotMs', max: 6}, {metric: 'wakes', equals: 9},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'store/restore-one-leaf@10k', improvement: 'R34-04', scenario: 'store/restore-one-leaf', args: [10000, 9],
        gates: [
            {metric: 'restoreRowWraps', equals: 1}, {metric: 'readRowWraps', equals: 1},
            {metric: 'restoreMs', over: 'snapshotMs', max: 4}, {metric: 'wakes', equals: 9},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'store/dehydrate@10k', improvement: 'R34-05', scenario: 'store/dehydrate', args: [10000, 15],
        gates: [
            {metric: 'scopeStringifyMs', over: 'dehydrateStringifyMs', max: 0.8},
            {metric: 'samePayload', equals: true},
        ],
    },
    {
        id: 'store/r32-deep-clone@10k', improvement: 'R32-08', scenario: 'store/r32-deep-clone',
        args: [10000, 31],
        gates: [
            {metric: 'snapshotObjectCreates', equals: 0}, {metric: 'probeControlCreates', equals: 1},
            {metric: 'copied', equals: true},
        ],
    },
    {
        id: 'store/r33-persist@10k', improvement: 'R33-07', scenario: 'store/r33-persist',
        args: [10000, 50],
        gates: [
            {metric: 'setItemCallsDefault', equals: 1}, {metric: 'setItemCallsNoCoalesce', equals: 50},
            {metric: 'defaultMs', over: 'noCoalesceMs', max: 0.5},
            {metric: 'defaultContentOk', equals: true}, {metric: 'noCoalesceContentOk', equals: true},
        ],
    },
];
