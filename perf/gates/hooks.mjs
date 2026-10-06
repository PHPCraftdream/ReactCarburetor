/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Hooks. Render counts and rendered text are exact; times are >= 10x ceilings that still sit
// below the pre-fix cost, and the size scale gate is machine independent.
const related = mode => ({
    id: `hooks/drift-after-related@10k-${mode}`, improvement: 'R34-01', scenario: 'hooks/drift-after-related',
    args: [10000, mode, 15],
    gates: [
        {metric: 'renderBeforeMs', max: 6}, {metric: 'renderAfterMs', max: 4},
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
            {metric: 'rowRendersPerEdit', equals: 1},
            {metric: 'text', equals: 'edit 8|nine|pushed|1001'},
        ],
    },
    {
        id: 'hooks/memo-rows@10k', improvement: 'R34-02', scenario: 'hooks/memo-rows', args: [10000, 9],
        gates: [
            {metric: 'rowRendersPerEdit', equals: 1},
            {metric: 'editMs', scale: {from: 'hooks/memo-rows@1k'}, max: 40},
            {metric: 'text', equals: 'edit 8|nine|pushed|10001'},
        ],
    },
    {
        id: 'hooks/r33-snapshot@10k', improvement: 'R33-02', scenario: 'hooks/r33-snapshot',
        args: [10000, 15],
        gates: [
            {metric: 'stableWriteSelectorRuns', equals: 0}, {metric: 'stableNoWriteSelectorRuns', equals: 0},
            {metric: 'inlineRuns', equals: 15},
            {metric: 'stableWriteMs', max: 20}, {metric: 'inlineRenderMs', max: 20},
            {metric: 'text', equals: 'edited|10001|edited|10001'},
        ],
    },
];
