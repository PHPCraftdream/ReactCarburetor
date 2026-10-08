/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Hooks. Render counts and rendered text are exact; times are >= 10x ceilings that still sit
// below the pre-fix cost, and the size scale gate is machine independent.
const related = mode => ({
    id: `hooks/drift-after-related@10k-${mode}`, improvement: 'R34-01', scenario: 'hooks/drift-after-related',
    args: [10000, mode, 15],
    gates: [
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
            {metric: 'inlineRenderMs', max: 20},
            {metric: 'text', equals: 'edited|10001|edited|10001'},
        ],
    },
    // PG-C2
    // Observed --runs 3: 1a02d29eec30: coldInitializers 200 -> 100; warmInitializers 100 -> 0.
    // unchangedSubscriptions 1 -> 0; changed renders 100 (one per reader).
    {
        id: 'hooks/lazy-watch@100', improvement: 'R30-10',
        scenario: 'hooks/pg-c2/lazy-watch',
        gates: [
            {metric: 'coldInitializers', min: 100},
            {metric: 'warmInitializers', equals: 0},
            {metric: 'mountOnce', equals: true},
            {metric: 'warmOnce', equals: true},
            {metric: 'changedOnce', equals: true},
            {metric: 'changedRenders', equals: 100},
            {metric: 'coldSubscriptions', equals: 1},
            {metric: 'unchangedSubscriptions', equals: 0},
            {metric: 'unchangedSelectorCalls', equals: 1},
            {metric: 'unchangedCallbacks', equals: 0},
            {metric: 'switchedSubscriptions', equals: 1},
            {metric: 'switchedSelectorCalls', equals: 1},
            {metric: 'obsoleteSelectorCalls', equals: 0},
            {metric: 'changedCallbacks', equals: 1},
            {metric: 'done', equals: true},
        ],
    },
    // Observed --runs 3: 829c3ea9c8bf: equalRenders 100 -> 0; equal body/comparison 1/1; changed renders 100.
    {
        id: 'hooks/equals-reference@100', improvement: 'R33-05',
        scenario: 'hooks/pg-c2/equals-reference',
        gates: [
            {metric: 'mountOnce', equals: true},
            {metric: 'equalBodies', equals: 1},
            {metric: 'equalComparisons', equals: 1},
            {metric: 'equalAnnouncements', equals: 0},
            {metric: 'equalRenders', equals: 0},
            {metric: 'changedOnce', equals: true},
            {metric: 'changedRenders', equals: 100},
            {metric: 'changedBodies', equals: 1},
            {metric: 'changedComparisons', equals: 1},
            {metric: 'changedAnnouncements', equals: 1},
            {metric: 'done', equals: true},
        ],
    },
    // Observed --runs 3: 9386cd9a073c: equalRenders 100 -> 0; selector calls 100; changed renders 100.
    {
        id: 'hooks/default-equal@100', improvement: 'JS-R13-08',
        scenario: 'hooks/pg-c2/default-equal',
        gates: [
            {metric: 'mountOnce', equals: true},
            {metric: 'equalRenders', equals: 0},
            {metric: 'equalCalls', equals: 100},
            {metric: 'changedOnce', equals: true},
            {metric: 'changedRenders', equals: 100},
            {metric: 'changedCalls', equals: 100},
            {metric: 'done', equals: true},
        ],
    },
];
