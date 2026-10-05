/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Store. Ratios inside one run are machine independent.
export default [
    {
        id: 'store/restore-one-leaf@1k', improvement: 'R34-04', scenario: 'store/restore-one-leaf', args: [1000, 9],
        gates: [
            {metric: 'restoreMs', over: 'snapshotMs', max: 4}, {metric: 'wakes', equals: 9},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'store/restore-one-leaf@10k', improvement: 'R34-04', scenario: 'store/restore-one-leaf', args: [10000, 9],
        gates: [
            {metric: 'restoreMs', over: 'snapshotMs', max: 3.5}, {metric: 'wakes', equals: 9},
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
];
