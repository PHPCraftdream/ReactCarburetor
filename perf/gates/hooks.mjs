/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Hooks. Render counts and rendered text are exact; times are generous ceilings (JSDOM on a shared
// machine), and the size scale gate is machine independent.
const related = mode => ({
    id: `hooks/drift-after-related@10k-${mode}`, improvement: 'R34-01', scenario: 'hooks/drift-after-related',
    args: [10000, mode, 15],
    gates: [
        {metric: 'renderBeforeMs', max: 3}, {metric: 'renderAfterMs', max: 3},
        {metric: 'writeLogMatchesBefore', equals: 0}, {metric: 'writeLogMatchesAfter', equals: 0},
        {metric: 'renders', equals: 35}, {metric: 'text', equals: 'edited|again|10001'},
    ],
});

export default [
    related('stable'),
    related('inline'),
    {
        id: 'hooks/memo-rows@1k', improvement: 'R34-02', scenario: 'hooks/memo-rows', args: [1000, 9],
        gates: [
            {metric: 'rowRendersPerEdit', equals: 1}, {metric: 'editMs', max: 500},
            {metric: 'text', equals: 'edit 8|nine|pushed|1001'},
        ],
    },
    {
        id: 'hooks/memo-rows@10k', improvement: 'R34-02', scenario: 'hooks/memo-rows', args: [10000, 9],
        gates: [
            {metric: 'rowRendersPerEdit', equals: 1}, {metric: 'editMs', max: 2500},
            {metric: 'editMs', scale: {from: 'hooks/memo-rows@1k'}, max: 40},
            {metric: 'text', equals: 'edit 8|nine|pushed|10001'},
        ],
    },
];
