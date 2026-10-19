/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// PERF round 46: a structural change of a selected list (append, tail pop) patches the container
// from the write log instead of reconciling every row.
export default [
    {
        id: 'selection46/structural-append@10k', improvement: 'R46-09',
        scenario: 'selection46/structural', args: ['append', 10000],
        gates: [
            // The full walk read every row (about 70k member paths); the patch reads the new row only.
            {metric: 'memberReads', max: 8},
            {metric: 'freshRows', equals: 1},
            // Positive control: an in-row write or a move still takes the full walk.
            {metric: 'controlReads', min: 10000},
            {metric: 'delivered', equals: '10001|10000'},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'selection46/structural-pop@10k', improvement: 'R46-09',
        scenario: 'selection46/structural', args: ['pop', 10000],
        gates: [
            // The full walk read every kept row (about 70k member paths); the patch reads none.
            {metric: 'memberReads', max: 2},
            {metric: 'freshRows', equals: 0},
            {metric: 'poppedCopyCollected', equals: true},
            {metric: 'controlReads', min: 10000},
            {metric: 'delivered', equals: '9999|9998'},
            {metric: 'done', equals: true},
        ],
    },
];
