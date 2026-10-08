/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R39-02. Baseline must fail patches/zero clones, not just timing. <=2 native/plain is
// reported separately as acceptance diagnostics; scale is deliberately generous on shared CPUs.
const aliasGates = [
    {metric: 'plainAliasControlWakes', equals: 1},
    {metric: 'nativeAliasControlWakes', equals: 1},
    {metric: 'aliasContractCorrect', equals: true},
];
const writeGates = [
    ...aliasGates,
    {metric: 'entryKind', equals: 'patches'},
    {metric: 'ownedClones', equals: 0}, {metric: 'clonedNodes', equals: 0},
    {metric: 'constructionClones', min: 1}, {metric: 'constructionNodes', min: 1000},
    {metric: 'constructionDateClones', min: 1},
    {metric: 'controlKind', equals: 'snapshot'}, {metric: 'controlOwnedClones', min: 1},
    {metric: 'controlClonedNodes', min: 1000}, {metric: 'controlDateClones', min: 1},
    {metric: 'postSnapshotKind', equals: 'patches'},
    {metric: 'postSnapshotOwnedClones', equals: 0}, {metric: 'postSnapshotClonedNodes', equals: 0},
    {metric: 'writeWakes', equals: 1}, {metric: 'writeAliasWakes', equals: 0},
    {metric: 'writeUnrelatedWakes', equals: 0},
    ...['writeCorrect', 'postSnapshotCorrect', 'postUndone', 'controlUndone', 'initialUndone',
        'initialRedone', 'controlRedone', 'postRedone', 'cursorCorrect']
        .map(metric => ({metric, equals: true})),
];
const undoGates = [
    ...aliasGates,
    {metric: 'constructionClones', min: 1}, {metric: 'constructionNodes', min: 1000},
    {metric: 'constructionDateClones', min: 1},
    {metric: 'entryKind', equals: 'patches'},
    {metric: 'undoOwnedClones', equals: 0}, {metric: 'undoClonedNodes', equals: 0},
    {metric: 'redoOwnedClones', equals: 0}, {metric: 'redoClonedNodes', equals: 0},
    {metric: 'wakes', equals: 3}, {metric: 'aliasWakes', equals: 0},
    {metric: 'unrelatedWakes', equals: 0},
    ...['writeCorrect', 'undoneCorrect', 'redoneCorrect', 'undoCursorCorrect', 'redoCursorCorrect']
        .map(metric => ({metric, equals: true})),
];
const scaleGates = [
    ...aliasGates,
    {metric: 'entryKind', equals: 'patches'},
    {metric: 'ownedClones', equals: 0}, {metric: 'clonedNodes', equals: 0},
    {metric: 'controlKind', equals: 'snapshot'}, {metric: 'controlOwnedClones', min: 1},
    {metric: 'controlClonedNodes', min: 1000}, {metric: 'controlDateClones', min: 1},
    {metric: 'unrelatedWakes', equals: 0},
    {metric: 'wakesCorrect', equals: true}, {metric: 'patchKindsCorrect', equals: true},
    {metric: 'statesCorrect', equals: true},
];
export default [
    ...[1000, 10000].flatMap(rows => [
        {
            id: `history39/native-scalar-write@${rows / 1000}k`, improvement: 'R39-02',
            scenario: 'history39/native-scalar-write', args: [rows], gates: writeGates,
        },
        {
            id: `history39/native-scalar-undo@${rows / 1000}k`, improvement: 'R39-02',
            scenario: 'history39/native-scalar-undo', args: [rows], gates: undoGates,
        },
    ]),
    {
        id: 'history39/scale@1k', improvement: 'R39-02',
        scenario: 'history39/scale', args: [1000], gates: scaleGates,
    },
    {
        id: 'history39/scale@10k', improvement: 'R39-02',
        scenario: 'history39/scale', args: [10000], gates: [
            ...scaleGates,
            {metric: 'plainOwnedClones', equals: 0}, {metric: 'plainClonedNodes', equals: 0},
            {metric: 'plainConstructionClones', min: 1}, {metric: 'plainConstructionNodes', min: 10000},
            {metric: 'plainSnapshotClones', min: 1}, {metric: 'plainSnapshotNodes', min: 10000},
            {metric: 'plainProbeCorrect', equals: true},
            ...['nativeWriteMs', 'nativeUndoMs', 'nativeRedoMs'].map(metric => ({
                metric, scale: {from: 'history39/scale@1k'}, max: 6,
            })),
        ],
    },
    {
        // 10k rows, one Date, 50 leaf writes: retained ~2 KB per entry now, ~627 KB before.
        id: 'history39/date-heap@10k', improvement: 'R39-02',
        scenario: 'history39/date-heap', args: [10000], gates: [
            {metric: 'datePerEntryKB', max: 50}, {metric: 'plainPerEntryKB', max: 50},
            {metric: 'snapshotPerEntryKB', min: 100},
            {metric: 'dateKind', equals: 'patches'}, {metric: 'plainKind', equals: 'patches'},
            {metric: 'snapshotKind', equals: 'snapshot'},
            {metric: 'dateEntries', equals: 50}, {metric: 'plainEntries', equals: 50},
            {metric: 'snapshotEntries', equals: 10}, {metric: 'done', equals: true},
        ],
    },
    {
        // Median of 15: write ~0.019 ms, undo ~0.023 ms now; ~26.6 / ~58 ms before.
        id: 'history39/date-timing@10k', improvement: 'R39-02',
        scenario: 'history39/date-timing', args: [10000], gates: [
            {metric: 'writeMs', max: 2}, {metric: 'undoMs', max: 3},
            {metric: 'allPatches', equals: true}, {metric: 'entries', equals: 18}, {metric: 'done', equals: true},
        ],
    },
    // PG-B1
    {
        id: 'history39/scale@10k-plain', improvement: 'JS-R16-07',
        scenario: 'history39/scale', args: [10000, 'plain'], gates: [
            {metric: 'plainOwnedClones', equals: 0}, {metric: 'plainClonedNodes', equals: 0},
            {metric: 'plainConstructionClones', min: 1}, {metric: 'plainConstructionNodes', min: 10000},
            {metric: 'plainSnapshotClones', min: 1}, {metric: 'plainSnapshotNodes', min: 10000},
            {metric: 'plainProbeCorrect', equals: true},
        ],
    },
];
