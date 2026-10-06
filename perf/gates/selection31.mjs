/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Selection. R31-03: sparse selections cost O(own indices) at every size; the kernel counters fall
// on pre-R31 builds (768/196608 hasOwn checks, 131072 wake checks at 65536). Dense (a
// same-cost control), the same-content notification and parity-wake entries are controls. R31-01 +
// R31-05: reordered Map/Set and equal Invalid Date answers; order gates fall on pre-R31 builds
// (0 notifications, stale DOM), Invalid Date gates fall with them (extra renders).
export default [
    {
        id: 'selection31/sparse@256', improvement: 'R31-03', scenario: 'selection31/sparse-selection', args: [256, 'sparse', 10],
        gates: [
            {metric: 'kernelHasOwnChecks', equals: 6}, {metric: 'detachOwnKeyCalls', equals: 3},
            {metric: 'presentIndexKeys', equals: 6}, {metric: 'notifications', equals: 0},
            {metric: 'sameContent', equals: true}, {metric: 'parityWakes', equals: 1}, {metric: 'holePreserved', equals: true},
        ],
    },
    {
        id: 'selection31/sparse@65536', improvement: 'R31-03', scenario: 'selection31/sparse-selection', args: [65536, 'sparse', 5],
        gates: [
            {metric: 'kernelHasOwnChecks', equals: 6}, {metric: 'detachOwnKeyCalls', equals: 3},
            {metric: 'presentIndexKeys', equals: 6}, {metric: 'wakeChecks', max: 1000},
            {metric: 'notifications', equals: 0}, {metric: 'sameContent', equals: true},
            {metric: 'holePreserved', equals: true},
        ],
    },
    {
        id: 'selection31/dense@256', improvement: 'control', scenario: 'selection31/sparse-selection', args: [256, 'dense', 10],
        gates: [
            {metric: 'kernelHasOwnChecks', equals: 768}, {metric: 'detachOwnKeyCalls', equals: 0},
            {metric: 'presentIndexKeys', equals: 0}, {metric: 'notifications', equals: 0},
            {metric: 'notifications', equals: 0}, {metric: 'sameContent', equals: true},
            {metric: 'parityWakes', equals: 1},
        ],
    },
    {
        id: 'selection31/native-order@watch', improvement: 'R31-01+R31-05', scenario: 'selection31/native-order',
        gates: [
            {metric: 'mapSameOrder', equals: 0}, {metric: 'mapReorder', min: 1}, {metric: 'setReorder', min: 1},
            {metric: 'invalidDateSame', equals: 0}, {metric: 'invalidToValid', equals: 1},
            {metric: 'liveMapOrder', equals: 'b,a'}, {metric: 'liveSetOrder', equals: 'b,a'},
        ],
    },
    {
        id: 'selection31/native-order@react', improvement: 'R31-01+R31-05', scenario: 'selection31/native-react',
        gates: [
            {metric: 'hookInitialRenders', equals: 1}, {metric: 'hookInitialText', equals: 'a|a'},
            {metric: 'hookSameOrderRenders', equals: 1},
            {metric: 'hookSameOrderText', equals: 'a|a'},
            {metric: 'hookReorderRenders', min: 2}, {metric: 'hookReorderText', equals: 'b|b'},
            {metric: 'memoInitialRenders', equals: 1}, {metric: 'memoSameOrderRenders', equals: 1},
            {metric: 'memoReorderRenders', min: 2}, {metric: 'memoReorderText', equals: 'b|b'},
            {metric: 'invalidSameRenders', equals: 1}, {metric: 'invalidSameText', equals: '0:NaN'},
            {metric: 'invalidToValidRenders', equals: 2}, {metric: 'invalidToValidText', equals: '0:0'},
        ],
    },
];
