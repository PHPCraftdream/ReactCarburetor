const opaqueAxes = [[4, 1, 32], [32, 1, 32], [256, 1, 32],
    [32, 3, 32], [32, 8, 32], [32, 3, 0], [32, 3, 512]];
const modes = ['native-first', 'native-middle', 'native-last', 'plain', 'noop'];
const scalarAxes = [1, 8, 32, 64, 256].map(p => [p, 2]).concat([[32, 1], [32, 8]]);
export default [
    ...opaqueAxes.flatMap(([n, k, padding]) => modes.flatMap(mode => [
        {
            id: `history44/after-opaque@${n}-${k}-${padding}-${mode}`, improvement: 'R44-S02',
            scenario: 'history44/after-opaque-endpoints', args: [n, k, padding, mode], gates: [
                {metric: 'afterOpaqueVisits', equals: 0}, {metric: 'positiveVisits', min: 6},
                {metric: 'cutoverUnusedOwnedNodes', equals: 0},
                {metric: 'unusedOwnedNodes', equals: 0}, {metric: 'positiveOwnedNodes', min: 6},
                {metric: 'preCutoverOwnedNodes',
                    min: ['native-middle', 'native-last', 'plain'].includes(mode) ? n + 2 : 0},
                {metric: 'writerEvents', equals: mode === 'noop' ? 0 : 2 * k - 1 + (mode === 'plain' ? 0 : 1)},
                ...['intrinsicsRestored', 'endpointsCorrect', 'publicationCorrect']
                    .map(metric => ({metric, equals: true})),
                {metric: 'spare', equals: 0},
            ],
        },
        {
            id: `history44/opaque-timing@${n}-${k}-${padding}-${mode}`, improvement: 'R44-S02',
            scenario: 'history44/timing', args: ['opaque', n, k, padding, mode], gates: [
                {metric: 'samples', equals: 7}, {metric: 'uninstrumented', equals: true},
                {metric: 'completedOperations', equals: true},
            ],
        },
    ])),
    ...scalarAxes.flatMap(([p, depth]) => ['repeat', 'distinct', 'separate'].flatMap(mode =>
        ['plain', 'native'].map(baseline => ({
            id: `history44/scalar-proof@${p}-${depth}-${mode}-${baseline}`, improvement: 'R44-S03',
            scenario: 'history44/scalar-final-proof', args: [p, depth, mode, baseline], gates: [
                {metric: 'writeWeakmaps', equals: 0}, {metric: 'undoWeakmaps', equals: 0},
                {metric: 'redoWeakmaps', equals: 0}, {metric: 'graphWeakmaps', min: 1},
                {metric: 'undoDescriptors', equals: 2 * (depth + 1) * (mode === 'separate' ? 1 : p)},
                {metric: 'redoDescriptors', equals: 2 * (depth + 1) * (mode === 'separate' ? 1 : p)},
                {metric: 'noOpBoundaries', equals: 0},
                {metric: 'undoChecksum', equals: mode === 'separate' ? p - 1 : 0},
                {metric: 'redoChecksum', equals: mode === 'distinct' ? p * (p + 1) / 2 : p},
                ...['traceCorrect', 'endpointsCorrect', 'publicationCorrect', 'intrinsicsRestored']
                    .map(metric => ({metric, equals: true})),
            ],
        })))),
    ...scalarAxes.flatMap(([p, depth]) => ['repeat', 'distinct', 'separate'].map(mode => ({
        id: `history44/scalar-timing@${p}-${depth}-${mode}`, improvement: 'R44-S03',
        scenario: 'history44/timing', args: ['scalar', p, depth, 0, mode], gates: [
            {metric: 'samples', equals: 7}, {metric: 'uninstrumented', equals: true},
            {metric: 'completedOperations', equals: true},
        ],
    }))),
    {
        id: 'history44/structural-markers', improvement: 'control',
        scenario: 'history44/structural-markers', args: [], gates: [
            {metric: 'cases', equals: 2}, {metric: 'structuralReplayCorrect', equals: true},
            {metric: 'publicationCorrect', equals: true},
        ],
    },
];
