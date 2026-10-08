/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Derived values. Bounds are ~50x the measured cost and ~100x below the cost before the fix, so
// they pass on a slow shared machine and fail the moment the O(read set) walk comes back.
export default [
    {
        id: 'derived/drift-after-recompute@10k', improvement: 'R34-01', scenario: 'derived/drift-after-recompute',
        args: [10000, 200],
        gates: [
            {metric: 'writeLogMatchesBefore', equals: 0},
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
    // PG-B1: 523d6a04a5f5 Set work ratio 249.74 -> 15.15; limit 20; six runs x3 pass.
    // Fan-in settle times remain diagnostic; empty window 0, copied-Set control 1 + 3.
    // K100 constructions/adds: 202/30601 -> 103/109; K1600: 3202/7689601 -> 1603/1609.
    {
        id: 'derived/r32-fan-in@1600', improvement: 'R32-02', scenario: 'derived/r32-fan-in', args: [],
        gates: [
            {metric: 'setWork1600', over: 'setWork100', max: 20},
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
    // PG-B1
    {
        id: 'derived/r32-fan-in-control@1600', improvement: 'control', scenario: 'derived/r32-fan-in', args: [],
        gates: [
            {metric: 'emptySetWork', equals: 0}, {metric: 'controlSetConstructions', equals: 1},
            {metric: 'controlSetAdds', equals: 3}, {metric: 'controlFanInWork100', min: 1},
            {metric: 'fanInValue100', equals: 24760}, {metric: 'fanInValue1600', equals: 6396010},
        ],
    },
];
