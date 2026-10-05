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
            {metric: 'getMs', max: 0.05}, {metric: 'writeLogMatches', equals: 0}, {metric: 'value', equals: 0.6666},
        ],
    },
];
