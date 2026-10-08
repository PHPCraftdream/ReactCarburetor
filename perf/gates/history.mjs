/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// History. PG-B1: raw-row enumeration separates pre-R34 replay; timings are diagnostics.
// R33-06 also counts subtree row walks.
export default [
    {
        id: 'history/undo-one-field@10k', improvement: 'R34-03', scenario: 'history/undo-one-field', args: [10000, 9],
        gates: [
            {metric: 'undoRowWalks', equals: 0}, {metric: 'redoRowWalks', equals: 0},
            {metric: 'emptyRowWalks', equals: 0}, {metric: 'snapshotUndoRowWalks', min: 10000},
            ...['snapshotCorrect', 'probeUndone', 'probeRedone'].map(metric => ({metric, equals: true})),
            {metric: 'wakes', equals: 28},
            {metric: 'done', equals: true}, {metric: 'undone', equals: false},
        ],
    },
    {
        id: 'history/undo-one-field@50k', improvement: 'R34-03', scenario: 'history/undo-one-field', args: [50000, 9],
        gates: [
            {metric: 'undoRowWalks', equals: 0}, {metric: 'redoRowWalks', equals: 0},
            {metric: 'emptyRowWalks', equals: 0}, {metric: 'snapshotUndoRowWalks', min: 50000},
            ...['snapshotCorrect', 'probeUndone', 'probeRedone'].map(metric => ({metric, equals: true})),
            {metric: 'wakes', equals: 28}, {metric: 'done', equals: true}, {metric: 'undone', equals: false},
        ],
    },
    {
        id: 'history/r33-patches@10k', improvement: 'R33-06', scenario: 'history/r33-patches', args: [],
        gates: [
            {metric: 'depRowWalks', equals: 0}, {metric: 'controlRowWalks', min: 5000},
            {metric: 'dep10kMs', over: 'dep1kMs', max: 5},
            {metric: 'undoneOk', equals: true}, {metric: 'redoneOk', equals: true},
            {metric: 'rowsUnchanged', equals: true}, {metric: 'subtreeRedoneOk', equals: true},
        ],
    },
    {
        id: 'history/r37-02-delivery@4-fields', improvement: 'R37-02', scenario: 'history/r37-02-delivery', args: [],
        gates: [
            {metric: 'delivered', equals: 4}, {metric: 'threwOriginalError', equals: true},
            {metric: 'installedOk', equals: true}, {metric: 'undoneOk', equals: true},
            {metric: 'redoneOk', equals: true},
            {metric: 'controlDelivered', equals: 4}, {metric: 'controlThrew', equals: false},
            {metric: 'controlUndoneOk', equals: true},
        ],
    },
    // PG-D1
    // a5ca525ec156: original row visits/copies 256 -> 128; Map follows all rows.
    {
        id: 'history/mixed-capture@128', improvement: 'R17-ENGINE-04', scenario: 'history/pg-d1/mixed-capture', args: [],
        gates: [
            {metric: 'rowVisits', equals: 128}, {metric: 'rowCopies', equals: 128},
            {metric: 'intermediateCopies', equals: 0},
        ],
    },
    {
        id: 'history/mixed-capture@128-control', improvement: 'control', scenario: 'history/pg-d1/mixed-capture', args: [],
        gates: [
            {metric: 'controlVisits', equals: 128}, {metric: 'controlCopies', equals: 256},
            {metric: 'idleVisits', equals: 0}, {metric: 'idleCopies', equals: 0},
            {metric: 'detached', equals: true}, {metric: 'isolated', equals: true},
            {metric: 'undoOk', equals: true}, {metric: 'redoOk', equals: true},
        ],
    },
];
