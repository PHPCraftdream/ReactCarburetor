const modes = ['one-update', 'transaction', 'manual-throttle', 'separate'];
const axes = [1, 8, 32, 64, 256].map(p => [p, 32])
    .concat([0, 512, 4096].map(unrelated => [32, unrelated]));
export default axes.flatMap(([p, unrelated]) => modes.flatMap(mode => [
    {
        id: `history43/scalar-batch@${p}-${unrelated}-${mode}`, improvement: 'R43-S02',
        scenario: 'history43/scalar-batch', args: [p, unrelated, mode], gates: [
            {metric: 'checks', equals: 0}, {metric: 'empty', equals: 0},
            {metric: 'positive', equals: 1},
            ...['descriptorsRestored', 'publicationCorrect', 'endpointsCorrect',
                'cancellationCorrect', 'ownedTargetCorrect'].map(metric => ({metric, equals: true})),
        ],
    },
    {
        id: `history43/timing@${p}-${unrelated}-${mode}`, improvement: 'R43-S02',
        scenario: 'history43/timing', args: [p, unrelated, mode], gates: [
            {metric: 'completedPublication', equals: true}, {metric: 'uninstrumented', equals: true},
            {metric: 'samples', equals: 7},
        ],
    },
]));
