/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Mechanism counters for the history/write-path round: fold-search scans (splice + bulk push
// with history), endpoint re-cloning on the history entry path, key scans and snapshot
// degradation on dictionary deletes, positional window work, and Date draft reads. Every
// counter bound is deterministic; timings stay out.
export default [
    {
        id: 'history45/fold-scan@1k', improvement: 'R45-S01',
        scenario: 'history45/fold-scan', args: [1000, 200], gates: [
            {metric: 'spliceScans', over: 'splicePatches', max: 12},
            {metric: 'pushScans', over: 'pushPatches', max: 24},
            {metric: 'spliceTaps', min: 1}, {metric: 'controlPatches', equals: 2},
            {metric: 'foldControl', min: 1},
            ...['spliceCorrect', 'pushCorrect', 'foldControlCorrect'].map(m => ({metric: m, equals: true})),
        ],
    },
    {
        id: 'history45/fold-scan@4k', improvement: 'R45-S01',
        scenario: 'history45/fold-scan', args: [4000, 800], gates: [
            {metric: 'spliceScans', over: 'splicePatches', max: 12},
            {metric: 'pushScans', over: 'pushPatches', max: 24},
            {metric: 'spliceTaps', min: 1}, {metric: 'controlPatches', equals: 2},
            {metric: 'foldControl', min: 1},
            ...['spliceCorrect', 'pushCorrect', 'foldControlCorrect'].map(m => ({metric: m, equals: true})),
        ],
    },
    {
        id: 'history45/delete-keys@4k', improvement: 'R45-S03',
        scenario: 'history45/delete-keys', args: [4096, 64], gates: [
            // The mechanism: a middle-key deletion with history keeps the entry patch-shaped
            // (O(delta) memory, ordered undo) instead of collapsing to a full-state snapshot.
            // bulkKeyVisits bounds the delete path's key enumeration: linear in K + D (two
            // constant enumerations per publication), not the K x D the per-delete scan cost.
            {metric: 'singleKind', equals: 'patches'}, {metric: 'bulkKind', equals: 'patches'},
            {metric: 'lastKind', equals: 'patches'},
            {metric: 'bulkPatches', equals: 64},
            {metric: 'bulkKeyVisits', max: 20000}, {metric: 'singleKeyVisits', max: 12000},
            ...['singleCorrect', 'bulkCorrect', 'restoreCheck', 'lastCorrect']
                .map(m => ({metric: m, equals: true})),
        ],
    },
    {
        id: 'history45/positional-window@10k', improvement: 'R45-S04',
        scenario: 'history45/positional-window', args: [10000], gates: [
            {metric: 'tailSpliceOwn', max: 32}, {metric: 'replaceSpliceOwn', max: 32},
            {metric: 'fillWindowOwn', max: 48}, {metric: 'copyWindowOwn', max: 48},
            {metric: 'headSpliceOwn', min: 19000}, {metric: 'shiftAllOwn', min: 19000},
            {metric: 'allCorrect', equals: true},
        ],
    },
];
