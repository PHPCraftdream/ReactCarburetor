/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Container reads over one complete walk (restore: over its scan) of the same rows, as pre-change -> now -> bound:
// collapse 2.5k 4.77 -> 2.52 -> 2.75, collapse 10k 4.47 -> 2.22 -> 2.75, root collapse 10k 6.22 -> 2.22 -> 2.5,
// precise 2500-of-10k 5.29 -> 3.22 -> 3.5, restore one leaf 6.00 -> 4.00 -> 4.5, restore full 5.15 -> 2.75 -> 3.25.
export default [
    {
        id: 'diff46/threshold-reads@10k', area: 'diff46', improvement: 'R46-06',
        scenario: 'diff46/threshold-reads', args: [],
        gates: [
            {metric: 'collapseReads2500', over: 'walkReads2500', max: 2.75},
            {metric: 'collapseReads10k', over: 'walkReads10k', max: 2.75},
            {metric: 'rootReads10k', over: 'rootWalkReads10k', max: 2.5},
            {metric: 'preciseReads', over: 'walkReads10k', max: 3.5},
            {metric: 'restoreReadsOne', over: 'scanReadsOne', max: 4.5},
            {metric: 'restoreReadsFull', over: 'scanReadsFull', max: 3.25},
            // Controls: the instrumentation sees the walk, an under-threshold diff stays one walk,
            // the buffer stays bounded.
            {metric: 'walkReads10k', min: 50000}, {metric: 'scanReadsOne', min: 10000},
            {metric: 'underReads1500', over: 'walkReads1500', max: 1.05}, {metric: 'underPaths1500', equals: 1500},
            {metric: 'longestBuffer', max: 2001}, {metric: 'finalPatches', equals: 1},
            {metric: 'bufferedCollapsed', equals: true},
            {metric: 'precisePaths', equals: 2500}, {metric: 'preciseLeaf', equals: true},
            {metric: 'collapsed', equals: true}, {metric: 'rootKeys', equals: 'rows'},
            {metric: 'restoreOneApplied', equals: true}, {metric: 'restoreFullApplied', equals: false},
            {metric: 'valid', equals: true},
        ],
    },
];
