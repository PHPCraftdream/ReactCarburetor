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
        id: 'state/resource-history', improvement: 'R19-ENGINE-02', scenario: 'state/resource-history', args: [128, 7],
        gates: [
            {metric: 'ordinarySnapshots', equals: 1},
            {metric: 'resourceLoads', equals: 64}, {metric: 'resourceSnapshots', equals: 129},
            {metric: 'resourceOk', equals: true},
            {metric: 'rootVisits', equals: 0}, {metric: 'dictionaryVisits', equals: 0}, {metric: 'entryVisits', equals: 0},
            {metric: 'ordinaryOk', equals: true}, {metric: 'cacheOk', equals: true},
            {metric: 'undoOk', equals: true}, {metric: 'redoOk', equals: true},
        ],
    },
    // PG-D1
    // fabde0984e9c: construction copies 10000 -> 10000, defines 30000 -> 0.
    // Snapshot publication: original/intermediate copies 10000/10000 -> 10000/0,
    // defines 60000 -> 0. The mirror-copy removal is not in 984ad79 itself;
    // R16-PERF-01's demonstrated mechanism is replacing per-key defineProperty.
    {
        id: 'state/resource-history@plain-10k', improvement: 'R16-PERF-01', scenario: 'state/pg-d1/resource-history', args: [],
        gates: [
            {metric: 'constructionDefines', equals: 0}, {metric: 'captureDefines', equals: 0},
            {metric: 'captureCopies', equals: 10000}, {metric: 'captureIntermediateCopies', equals: 0},
        ],
    },
    {
        id: 'state/resource-history@plain-10k-control', improvement: 'control', scenario: 'state/pg-d1/resource-history', args: [],
        gates: [
            {metric: 'constructionCopies', equals: 10000}, {metric: 'constructionOriginalCopies', equals: 10000},
            {metric: 'constructionIntermediateCopies', equals: 0}, {metric: 'captureOriginalCopies', equals: 10000},
            {metric: 'snapshotKind', equals: 'snapshot'}, {metric: 'controlCopies', equals: 20000},
            {metric: 'controlDefines', equals: 10000}, {metric: 'nativeCopies', equals: 8},
            {metric: 'idleCopies', equals: 0}, {metric: 'idleVisits', equals: 0},
            {metric: 'nativeDetached', equals: true}, {metric: 'detached', equals: true},
            {metric: 'isolated', equals: true}, {metric: 'undoOk', equals: true}, {metric: 'redoOk', equals: true},
        ],
    },
    // PG-HEAP
    // c15fb04c0472: snapshot/truncation index visits 1000000/999999 -> 3/3.
    // Production elides validation; no validator claim. Dense visits 32/31, idle 0 on both.
    {
        id: 'state/restore-array-length@sparse', improvement: 'R7-03', scenario: 'state/pg-heap/restore-array-length', args: [],
        gates: [
            {metric: 'snapshotIndexVisits', max: 10}, {metric: 'truncateIndexVisits', max: 10},
            {metric: 'sparseHoleWakes', equals: 0}, {metric: 'sparseLengthWakes', equals: 1},
            {metric: 'sparseRemovedKeyWakes', equals: 1}, {metric: 'sparseLengthAfter', equals: 1},
        ],
    },
    {
        id: 'state/restore-array-length@sparse-control', improvement: 'control', scenario: 'state/pg-heap/restore-array-length', args: [],
        gates: [
            {metric: 'length', equals: 1000000}, {metric: 'ownIndices', equals: 3},
            {metric: 'denseSnapshotIndexVisits', equals: 32}, {metric: 'denseTruncateIndexVisits', equals: 31},
            {metric: 'idleVisits', equals: 0}, {metric: 'snapshotOk', equals: true},
            {metric: 'truncateOk', equals: true}, {metric: 'denseOk', equals: true},
        ],
    },
    // 728d5c8c5f3b: one unlocked replacement 2/2/8 -> 0/0/0; original 7-sample gate 14/14/56.
    {
        id: 'state/resource-history@unlocked', improvement: 'R19-ENGINE-02', scenario: 'state/pg-heap/resource-history', args: [],
        gates: [
            {metric: 'rootVisits', equals: 0}, {metric: 'dictionaryVisits', equals: 0}, {metric: 'entryVisits', equals: 0},
        ],
    },
    {
        id: 'state/resource-history@unlocked-control', improvement: 'control', scenario: 'state/pg-heap/resource-history', args: [],
        gates: [
            {metric: 'controlRootVisits', equals: 1}, {metric: 'controlDictionaryVisits', equals: 1},
            {metric: 'controlEntryVisits', equals: 8},
            {metric: 'idleRootVisits', equals: 0}, {metric: 'idleDictionaryVisits', equals: 0}, {metric: 'idleEntryVisits', equals: 0},
            {metric: 'cacheOk', equals: true}, {metric: 'undoOk', equals: true}, {metric: 'redoOk', equals: true},
        ],
    },
]
