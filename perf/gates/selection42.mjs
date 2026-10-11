/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Timings are report-only: parent harness alternates independent processes/builds; no tiny ceiling.
export default [16, 128, 512, 4096, 16384].map(width => ({
    id: `selection42/outside-dictionary@${width}`, improvement: 'R42-S01',
    scenario: 'selection42/outside-dictionary', args: [width, 7, 16],
    gates: [
        {metric: 'outsideCalls', equals: 0}, {metric: 'outsideKeys', equals: 0},
        {metric: 'outsideDeliveries', equals: 0}, {metric: 'selectedEdits', equals: 2},
        {metric: 'trackedReads', equals: 16}, {metric: 'outsideSelectors', equals: 8},
        {metric: 'heldIdentity', equals: true}, {metric: 'historyCorrect', equals: true},
        {metric: 'untouchedShared', equals: true},
        {metric: 'heldChecksum', equals: width * (width - 1) / 2 - 1},
        {metric: 'finalChecksum', equals: width * (width - 1) / 2 - 2},
        {metric: 'emptyCalls', equals: 0}, {metric: 'positiveCalls', equals: 1},
        {metric: 'positiveKeys', equals: width}, {metric: 'selectedCalls', min: 1},
        {metric: 'selectedKeys', min: width}, {metric: 'arrayCalls', equals: 0},
        {metric: 'arrayKeys', equals: 0}, {metric: 'arrayEdits', equals: 2},
        {metric: 'arrayChecksum', equals: width * (width - 1) / 2 - 2},
        {metric: 'timingCallbacks', equals: 1248}, {metric: 'timingChecksum', equals: -779376},
    ],
})).concat([{
    id: 'selection42/controls', improvement: 'control', scenario: 'selection42/controls', args: [],
    gates: [
        {metric: 'denseDeliveries', equals: 1}, {metric: 'denseChecksum', equals: 136128},
        {metric: 'replacementDeliveries', equals: 2}, {metric: 'replacementChecksum', equals: 11},
        {metric: 'nativeDeliveries', equals: 2}, {metric: 'nativeChecksum', equals: 2002},
        {metric: 'rawDateAutoDeliveries', equals: 0}, {metric: 'sparseDeliveries', equals: 3},
        {metric: 'sparseChecksum', equals: 64}, {metric: 'overflowDeliveries', equals: 1},
        {metric: 'overflowMember', equals: 2}, {metric: 'overflowSource', equals: 4102},
        {metric: 'unknownDeliveries', equals: 1}, {metric: 'unknownMember', equals: 3},
        {metric: 'detachedHistory', equals: true}, {metric: 'sparseOwnUndefined', equals: true},
        {metric: 'ancestorRootCorrect', equals: true}, {metric: 'rawExposureCorrect', equals: true},
        {metric: 'conservativeCorrect', equals: true},
    ],
}]);
