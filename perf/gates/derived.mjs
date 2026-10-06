/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Derived values. Bounds are ~50x the measured cost and ~100x below the cost before the fix, so
// they pass on a slow shared machine and fail the moment the O(read set) walk comes back.
export default [
    {
        id: 'derived/drift-after-recompute@10k', improvement: 'R34-01', scenario: 'derived/drift-after-recompute',
        args: [10000, 200],
        gates: [
            {metric: 'getBeforeRecomputeMs', max: 0.05}, {metric: 'writeLogMatchesBefore', equals: 0},
            {metric: 'getAfterRecomputeMs', max: 0.05}, {metric: 'writeLogMatchesAfter', equals: 0},
            {metric: 'value', equals: 6665},
        ],
    },
    {
        id: 'derived/drift-fan-in@10k', improvement: 'R34-01', scenario: 'derived/drift-fan-in',
        args: [10000, 200],
        gates: [
            {metric: 'getMs', max: 0.05}, {metric: 'writeLogMatches', equals: 0},
            {metric: 'recomputes', equals: 0}, {metric: 'value', equals: 0.6666},
            {metric: 'relatedRecomputes', equals: 1}, {metric: 'valueAfterRelated', equals: 0.6665},
        ],
    },
    {
        id: 'derived/r32-fan-in@1600', improvement: 'R32-02', scenario: 'derived/r32-fan-in', args: [],
        gates: [
            {metric: 'settle1600Ms', over: 'settle100Ms', max: 80},
            {metric: 'outerRuns', equals: 10}, {metric: 'value', equals: 6396009},
        ],
    },
    {
        id: 'derived/r33-live-branch@10k', improvement: 'R33-01', scenario: 'derived/r33-live-branch',
        args: [10000, 9],
        gates: [
            {metric: 'settleWalks', equals: 0}, {metric: 'controlRowWalks', equals: 10000},
            {metric: 'settleMs', max: 6}, {metric: 'wakes', equals: 9}, {metric: 'title', equals: 'x8'},
        ],
    },
    {
        id: 'derived/r33-drift-get-after-write@10k', improvement: 'R33-03', scenario: 'derived/r33-drift-get-after-write',
        args: [10000, 200],
        gates: [
            {metric: 'getMs', max: 0.5}, {metric: 'writeLogMatches', equals: 0},
            {metric: 'recomputes', equals: 0}, {metric: 'value', equals: 5000},
            {metric: 'relatedRecomputes', equals: 1}, {metric: 'valueAfterRelated', equals: 5001},
        ],
    },
];
