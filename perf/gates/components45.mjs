// PERF round 45: a flat connectSelection wake skips the full reconcile, so delivering one
// related write constructs no graph collections for the woken flat rows.
export default [
    {
        id: 'components45/connect-wake-flat@128', improvement: 'R45-03',
        scenario: 'components45/connect-wake-flat', args: [128],
        gates: [
            {metric: 'collections', max: 3},
            {metric: 'quietRows', equals: 1},
            {metric: 'flatInitial', equals: 128},
            {metric: 'nestedInitial', equals: 1},
            {metric: 'flatCorrect', equals: true},
            {metric: 'nestedCorrect', equals: true},
            {metric: 'done', equals: true},
        ],
    },
];
