/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
export default [
    {
        id: 'selection36/memo-moves@2k', improvement: 'R36-06', scenario: 'selection36/memo-moves', args: [2000],
        gates: [
            {metric: 'memoRowRendersOnUnshift', equals: 1},
            {metric: 'memoRowRendersOnMove', equals: 0},
            {metric: 'editRenders', equals: 1},
            {metric: 'text', equals: 'new|Row 1999|Row 0|edited|2001'},
        ],
    },
    {
        id: 'selection36/related-walk@1k', improvement: 'R36-01', scenario: 'selection36/related-walk', args: [1000, 9],
        gates: [
            {metric: 'hookReadsPerWrite', max: 40}, {metric: 'watchReadsPerWrite', max: 40},
            {metric: 'controlReadsPerWrite', min: 1000},
            {metric: 'text', equals: 'p0|f0|w8'},
        ],
    },
    {
        id: 'selection36/related-walk@10k', improvement: 'R36-01', scenario: 'selection36/related-walk', args: [10000, 9],
        gates: [
            {metric: 'hookReadsPerWrite', max: 40}, {metric: 'watchReadsPerWrite', max: 40},
            // Linear in the rows, so the control proves the counter sees a full walk at this size.
            {metric: 'controlReadsPerWrite', min: 10000},
            {metric: 'hookReadsPerWrite', scale: {from: 'selection36/related-walk@1k'}, max: 2},
            {metric: 'text', equals: 'p0|f0|w8'},
        ],
    },
    {
        id: 'selection36/class-selection@2k', improvement: 'R36-02', scenario: 'selection36/class-selection', args: [2000, 6],
        gates: [
            // A move wakes the row that loses the selection and the row that gains it; the control wakes all.
            {metric: 'gatedRowRendersPerMove', equals: 2}, {metric: 'plainRowRendersPerMove', equals: 2000},
            {metric: 'selectedRow', equals: '18'},
            {metric: 'parentReadsNoWrite', max: 40}, {metric: 'parentReadsPerRelatedWrite', max: 60},
            {metric: 'controlParentReads', min: 2000},
            {metric: 'text', equals: 'edited|edited'},
        ],
    },
];
