/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Resource values/publication control; R10-06 identity counters live in PG-HEAP below.
export default [
    {
        id: 'views/set-data-identity@100', improvement: 'control', scenario: 'views/set-data-identity', args: [100],
        gates: [
            {metric: 'versionDeltaSame', equals: 0},
            {metric: 'versionDeltaNew', equals: 0},
            {metric: 'versionDeltaOne', equals: 1},
            {metric: 'value0Same', equals: 0}, {metric: 'value0New', equals: 0},
            {metric: 'value0OneChanged', equals: -1},
        ],
    },
    // PG-HEAP
    // R10-06 (e45f466ce88e): root new views 4000 -> 0, single-answer 4000 -> 1 (3999 retained).
    // All-answer control remains 4000 on both builds; idle remains 0.
    {
        id: 'views/set-data-identity@4000', improvement: 'R10-06',
        scenario: 'views/pg-heap/set-data-identity', args: [4000],
        gates: [
            {metric: 'newViews', equals: 0}, {metric: 'singleNewViews', equals: 1},
            {metric: 'singleSameViews', equals: 3999},
        ],
    },
    {
        id: 'views/set-data-identity@4000-control', improvement: 'control',
        scenario: 'views/pg-heap/set-data-identity', args: [4000],
        gates: [
            {metric: 'idleNewViews', equals: 0}, {metric: 'positiveNewViews', equals: 4000},
            {metric: 'repeatNewViews', equals: 0}, {metric: 'versionDeltaNew', equals: 0},
            {metric: 'singleChangedView', equals: true}, {metric: 'singleVersionDelta', equals: 1},
            {metric: 'positiveVersionDelta', equals: 1}, {metric: 'done', equals: true},
        ],
    },
]
