/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Descriptor writes through the draft. Exact counts of versions, deliveries, wakes and replay
// depths are the contract: value-preserving definitions record nothing (R10-01), index
// definitions wake exactly the touched readers (R10-02), a literal own `__proto__` is never a
// prototype change (R8-01), and a numeric history limit bounds undo depth (R8-04).
export default [
    {
        id: 'descriptors/define-omit@1000', improvement: 'R10-01', scenario: 'descriptors/define-omit',
        args: [1000],
        gates: [
            {metric: 'omitVersions', equals: 0}, {metric: 'omitDelivered', equals: 0},
            {metric: 'omitUndoDepth', equals: 0},
            {metric: 'changedVersions', equals: 1000}, {metric: 'changedDelivered', equals: 1000},
            {metric: 'changedUndoDepth', equals: 1000}, {metric: 'changedRedoDepth', equals: 1000},
            {metric: 'restoredLow', equals: 1}, {metric: 'finalCount', equals: 1001},
        ],
    },
    {
        id: 'descriptors/define-growth@250', improvement: 'R10-02', scenario: 'descriptors/define-growth',
        args: [250],
        gates: [
            {metric: 'lengthWakes', equals: 250}, {metric: 'keyWakes', equals: 250},
            {metric: 'untouchedWakes', equals: 0}, {metric: 'versions', equals: 250},
            {metric: 'undoDepth', equals: 250}, {metric: 'undoLength', equals: 1},
            {metric: 'redoDepth', equals: 250}, {metric: 'redoLength', equals: 251},
            {metric: 'lastAfterRedo', equals: 250},
        ],
    },
    {
        id: 'descriptors/define-history@300', improvement: 'R10-02', scenario: 'descriptors/define-history',
        args: [300],
        gates: [
            {metric: 'versions', equals: 300}, {metric: 'delivered', equals: 300},
            {metric: 'undos', equals: 300}, {metric: 'redos', equals: 300},
            {metric: 'undoneCount', equals: 0}, {metric: 'undoneLength', equals: 1},
            {metric: 'finalCount', equals: 300}, {metric: 'finalLength', equals: 301},
            {metric: 'lastAfterRedo', equals: 300},
        ],
    },
    {
        id: 'descriptors/proto-history@250', improvement: 'R8-01', scenario: 'descriptors/proto-history',
        args: [300, 250, 50],
        gates: [
            {metric: 'undoDepth', equals: 50}, {metric: 'redoDepth', equals: 50},
            {metric: 'drained', equals: 'initial'}, {metric: 'evicted', equals: 'updated-0'},
            {metric: 'protoWriteOwn', equals: 1}, {metric: 'protoWritePlain', equals: 1},
            {metric: 'protoWriteValue', equals: 7}, {metric: 'protoDelivered', equals: 2},
            {metric: 'protoVersion', equals: 2},
            {metric: 'protoUndoRootOwn', equals: 0}, {metric: 'protoUndoRootPlain', equals: 1},
            {metric: 'protoUndoNestOwn', equals: 0},
            {metric: 'protoRedoRootOwn', equals: 1}, {metric: 'protoRedoRootPlain', equals: 1},
            {metric: 'protoRedoNestOwn', equals: 1},
        ],
    },
];
