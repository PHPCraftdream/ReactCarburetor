/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Write path. View counts and ratios to an in-process JS copy are machine independent; the
// heap ceiling sits far above the fixed cost and far below the pre-R32-05 per-element cost.
export default [
    {
        id: 'write/normalize@10k', improvement: 'R32-01', scenario: 'write/normalize', args: [10000],
        gates: [
            {metric: 'proxiesAfterMap', equals: 0}, {metric: 'proxiesAfterSpread', equals: 0},
            {metric: 'proxiesAfterFilter', equals: 0}, {metric: 'proxiesAfterMeta', equals: 0},
            {metric: 'probeSeesViews', equals: true},
            {metric: 'identitiesKept', equals: true}, {metric: 'mapIdsOk', equals: true},
            {metric: 'spreadTitleOk', equals: true}, {metric: 'filterRemovedOk', equals: true},
            {metric: 'contentIntact', equals: true},
            {metric: 'mapWakes', equals: 0}, {metric: 'spreadWakes', equals: 0},
        ],
    },
    {
        id: 'write/one-row@10k', improvement: 'R32-05', scenario: 'write/one-row', args: [10000, 60],
        gates: [
            {metric: 'diffSize', equals: 1}, {metric: 'rowChanged', equals: true}, {metric: 'rowKept', equals: true},
            {metric: 'setDataMs', over: 'copyMs', max: 8},
            {metric: 'diffMs', over: 'copyMs', max: 8},
            {metric: 'allocKb', max: 64},
        ],
    },
    // PG-C2
    // Observed --runs 3: 1c100299e00c: replacementBodies 1 -> 0; titlePathOnly false -> true; changed bodies/renders 1/1.
    {
        id: 'write/object-replace-filter@4k', improvement: 'JS-R16-03',
        scenario: 'write/pg-c2/object-replace-filter',
        gates: [
            {metric: 'mountBodies', equals: 1},
            {metric: 'mountRenders', equals: 1},
            {metric: 'recordedPaths', equals: 1},
            {metric: 'titlePathOnly', equals: true},
            {metric: 'replacementBodies', equals: 0},
            {metric: 'replacementRenders', equals: 0},
            {metric: 'changedBodies', equals: 1},
            {metric: 'changedRenders', equals: 1},
            {metric: 'text', equals: '3999'},
            {metric: 'done', equals: true},
        ],
    },
];
