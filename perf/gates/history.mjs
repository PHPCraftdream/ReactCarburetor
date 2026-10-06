/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// History. Undo/redo of a one-field entry is O(patches): flat in the state size. The R33-06 row
// walk counter is the separator (10000 walks pre-fix, 0 now); the subtree timings stay ungated
// because their ratio does not separate the builds.
export default [
    {
        id: 'history/undo-one-field@10k', improvement: 'R34-03', scenario: 'history/undo-one-field', args: [10000, 9],
        gates: [
            {metric: 'undoMs', max: 2}, {metric: 'redoMs', max: 2}, {metric: 'wakes', equals: 28},
            {metric: 'done', equals: true}, {metric: 'undone', equals: false},
        ],
    },
    {
        id: 'history/undo-one-field@50k', improvement: 'R34-03', scenario: 'history/undo-one-field', args: [50000, 9],
        gates: [
            {metric: 'undoMs', max: 5}, {metric: 'redoMs', max: 5},
            {metric: 'undoMs', scale: {from: 'history/undo-one-field@10k'}, max: 6},
            {metric: 'redoMs', scale: {from: 'history/undo-one-field@10k'}, max: 6},
            {metric: 'wakes', equals: 28}, {metric: 'done', equals: true}, {metric: 'undone', equals: false},
        ],
    },
    {
        id: 'history/r33-patches@10k', improvement: 'R33-06', scenario: 'history/r33-patches', args: [],
        gates: [
            {metric: 'depRowWalks', equals: 0}, {metric: 'controlRowWalks', min: 5000},
            {metric: 'dep10kMs', max: 8},
            {metric: 'dep10kMs', over: 'dep1kMs', max: 5},
            {metric: 'undoneOk', equals: true}, {metric: 'redoneOk', equals: true},
            {metric: 'rowsUnchanged', equals: true}, {metric: 'subtreeRedoneOk', equals: true},
        ],
    },
];
