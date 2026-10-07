/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
export default [{
    id: 'selection38/cyclic-equality@production', improvement: 'R38-01', scenario: 'selection38/selection', args: [],
    gates: [
        {metric: 'readCounts', equals: '2,2,2'}, {metric: 'cycleCallbacks', equals: '0,0,0'},
        {metric: 'cycleControls', equals: true}, {metric: 'cycleQuietAfterTwo', equals: true},
        {metric: 'rawMemberPositive', equals: true}, {metric: 'done', equals: true},
    ],
}, {
    id: 'selection38/inactive-copy-release@10k', improvement: 'R38-02', scenario: 'selection38/selection', args: [],
    gates: [
        {metric: 'scalarRetained', equals: false}, {metric: 'objectControlRetained', equals: false},
        {metric: 'scalarAfterDispose', equals: false}, {metric: 'objectAfterDispose', equals: false},
        {metric: 'rawRowsAlive', equals: true}, {metric: 'done', equals: true},
    ],
}, {
    id: 'selection38/flat-primitive@128', improvement: 'R38-04', scenario: 'selection38/selection', args: [],
    gates: [
        {metric: 'flatWeakmaps', equals: '0,0,0'}, {metric: 'flatWeaksets', equals: '0,0,0'},
        {metric: 'flatCallbacks', equals: '0,0,0'},
        {metric: 'sparseWeakmaps', equals: 0}, {metric: 'sparseWeaksets', equals: 0}, {metric: 'sparsePositive', equals: true},
        {metric: 'sparseCallbacks', equals: 3}, {metric: 'sparseIndex0', equals: 2}, {metric: 'sparseHoles', equals: true},
        {metric: 'nestedWeakmaps', min: 1}, {metric: 'cycleWeakmaps', min: 1},
        {metric: 'nestedWeaksets', min: 1}, {metric: 'cycleWeaksets', min: 1}, {metric: 'positiveValid', equals: true},
        {metric: 'manySelectorCalls', equals: '64,64,64,128,128,128'},
        {metric: 'manyCallbacks', equals: '0,0,0,0,0,0'}, {metric: 'manyWeakmaps', equals: '0,0,0,0,0,0'},
        {metric: 'manyWeaksets', equals: '0,0,0,0,0,0'}, {metric: 'done', equals: true},
    ],
}, {
    id: 'selection38/class-primitive-ledger@3', improvement: 'R38-05', scenario: 'selection38/selection', args: [],
    gates: [
        {metric: 'classPrimitiveRenders', equals: 3}, {metric: 'classPrimitiveCalls', equals: 3},
        {metric: 'classPrimitiveValue', equals: '0'}, {metric: 'classPrimitiveWeakmaps', equals: 0},
        {metric: 'classObjectRenders', equals: 3}, {metric: 'classObjectCalls', equals: 3},
        {metric: 'classObjectValue', equals: '0'}, {metric: 'classObjectWeakmaps', min: 1},
        {metric: 'classClassValueValid', equals: true}, {metric: 'done', equals: true},
    ],
}, {
    id: 'selection38/sparse-raw-cap@4k', improvement: 'R37-04', scenario: 'selection38/sparse-boundary', args: [4000],
    gates: [
        {metric: 'sparseReads', equals: '2047,2051,2201'}, {metric: 'maxSparseRatio', max: 0.25},
        {metric: 'denseReads', min: 8000}, {metric: 'callbacks', equals: '2,2,2'},
        {metric: 'sparseValues', equals: true}, {metric: 'denseValues', equals: true}, {metric: 'done', equals: true},
    ],
}, {
    id: 'selection38/sparse-raw-cap@16k', improvement: 'R37-04', scenario: 'selection38/sparse-boundary', args: [16000],
    gates: [
        {metric: 'sparseReads', equals: '5001'}, {metric: 'maxSparseRatio', max: 0.25},
        {metric: 'denseReads', min: 32000}, {metric: 'callbacks', equals: '2'},
        {metric: 'sparseValues', equals: true}, {metric: 'denseValues', equals: true}, {metric: 'done', equals: true},
    ],
}, {
    id: 'selection38/native-read-precision@1k', improvement: 'control', scenario: 'selection38/native-precision', args: [],
    gates: [
        {metric: 'unrelatedSizeRenders', equals: 0}, {metric: 'unrelatedLookupRenders', equals: 0},
        {metric: 'ownSizeRenders', equals: 0}, {metric: 'ownLookupRenders', equals: 1},
        {metric: 'nativeSizeRenders', equals: 1}, {metric: 'graphDeliveries', equals: 3},
        {metric: 'valuesCorrect', equals: true}, {metric: 'done', equals: true},
    ],
}, {
    id: 'selection38/footprint-lifecycle@5000', improvement: 'R38-01', scenario: 'selection38/footprint-lifecycle', args: [],
    gates: [
        {metric: 'lifecycleReads', equals: 10000}, {metric: 'earlyReads', equals: 2000},
        {metric: 'lateReads', equals: 2000}, {metric: 'equalCallbacks', equals: 0},
        {metric: 'transactionReads', equals: 2}, {metric: 'transactionQuiet', equals: true},
        {metric: 'changedReads', min: 64}, {metric: 'changed', equals: true},
        {metric: 'overflowCorrect', equals: true}, {metric: 'expiredOwnerRetained', equals: false},
        {metric: 'unknownPublicationCorrect', equals: true},
        {metric: 'latestOwner', equals: 10001}, {metric: 'done', equals: true},
    ],
}];
