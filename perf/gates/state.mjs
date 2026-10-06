/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// State model, restore length, date identity, resource history: exact counters first; the
// snapshot cost is bounded by the 4k/1k size scale and sparse clone work by a generous ceiling
// far below a hole walk.
export default [
    {
        id: 'state/state-model@1k', improvement: 'R6-02', scenario: 'state/state-model', args: [1000],
        gates: [
            {metric: 'symbolInSnapshot', equals: false}, {metric: 'arrayCustomInSnapshot', equals: false},
            {metric: 'symbolWriteThrows', equals: true},
            {metric: 'rowEditWakes', equals: 1}, {metric: 'noOpRestoreWakes', equals: 0},
            {metric: 'finalTitle', equals: 'changed'},
            {metric: 'historyCaptures', equals: 1}, {metric: 'setDataTitle', equals: 'changed'},
            {metric: 'restoreOneTitle', equals: 'restored'},
            {metric: 'pushLength', equals: 1001}, {metric: 'readMapTitles', equals: 1000},
        ],
    },
    {
        id: 'state/state-model@4k', improvement: 'R6-02', scenario: 'state/state-model', args: [4000],
        gates: [
            {metric: 'symbolInSnapshot', equals: false}, {metric: 'arrayCustomInSnapshot', equals: false},
            {metric: 'symbolWriteThrows', equals: true},
            {metric: 'historyCaptures', equals: 1}, {metric: 'setDataTitle', equals: 'changed'},
            {metric: 'restoreOneTitle', equals: 'restored'},
            {metric: 'pushLength', equals: 4001}, {metric: 'readMapTitles', equals: 4000},
            {metric: 'snapshotMs', scale: {from: 'state/state-model@1k'}, max: 15},
        ],
    },
    {
        id: 'state/restore-array-length', improvement: 'R6-01', scenario: 'state/restore-array-length', args: [100],
        gates: [
            {metric: 'sparseLength', equals: 2000}, {metric: 'nestedSparseLength', equals: 2000},
            {metric: 'denseLength', equals: 2000}, {metric: 'shrinkLength', equals: 10},
        ],
    },
    {
        id: 'state/restore-array-length@sparse', improvement: 'R7-03', scenario: 'state/restore-array-length',
        args: [100, 100000],
        gates: [
            {metric: 'sparseHoleWakes', equals: 0}, {metric: 'sparseLengthWakes', equals: 1},
            {metric: 'sparseRemovedKeyWakes', equals: 1},
            {metric: 'sparseLengthAfter', equals: 1},
        ],
    },
    {
        id: 'state/date-aliases', improvement: 'R11-05', scenario: 'state/date-aliases', args: [100],
        gates: [
            {metric: 'distinctDates', equals: 100}, {metric: 'dateLookups', equals: 100},
            {metric: 'keyFirstCopies', equals: 100}, {metric: 'mapFirstCopies', equals: 100},
            {metric: 'keyFirstLookups', equals: 100}, {metric: 'mapFirstLookups', equals: 100},
            {metric: 'detachedKeyIsolated', equals: true},
            {metric: 'persistWrites', equals: 100}, {metric: 'persistSnapshots', equals: 0},
            {metric: 'persistChars', min: 1000},
        ],
    },
    {
        id: 'state/resource-history', improvement: 'R19-02', scenario: 'state/resource-history', args: [128, 7],
        gates: [
            {metric: 'ordinarySnapshots', equals: 1},
            {metric: 'resourceLoads', equals: 64}, {metric: 'resourceSnapshots', equals: 129},
            {metric: 'resourceOk', equals: true},
            {metric: 'rootVisits', equals: 0}, {metric: 'dictionaryVisits', equals: 0}, {metric: 'entryVisits', equals: 0},
            {metric: 'ordinaryOk', equals: true}, {metric: 'cacheOk', equals: true},
            {metric: 'undoOk', equals: true}, {metric: 'redoOk', equals: true},
        ],
    },
]
