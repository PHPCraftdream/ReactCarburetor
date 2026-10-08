/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// PG-B1 hook timings are diagnostic; settled-pull Object.keys counts guard JS-R13-04.
// Computed pulls, freshness and hook delivery. Evaluation, notification and snapshot-record
// counts are the contract; the 128-dependency pull cost is judged against the 1-dependency
// cost (machine independent) with a ceiling far below the pre-fix walk.
// Guards: R15 per-pull dependency bookkeeping, R10-03 hook
// publication records, R10-04 external computed dependencies; the native freshness entries are
// controls (native computed was already correct before R15).
const counters = [
    {metric: 'bodyEvalsStable', equals: 0}, {metric: 'bodyEvalsChanged', equals: 20},
    {metric: 'announcements', equals: 20}, {metric: 'renders', equals: 20},
    {metric: 'stableSnapshotRecords', equals: 0}, {metric: 'changedSnapshotRecords', equals: 20},
    {metric: 'text', equals: '20'},
];

export default [
    {
        id: 'computed/pulls@1', improvement: 'R15', scenario: 'computed/pulls', args: [1, 10000],
        gates: [
            {metric: 'stableEvals', equals: 0}, {metric: 'unrelatedEvals', equals: 0},
            {metric: 'changedEvals', equals: 1}, {metric: 'value', equals: 2},
            {metric: 'fanIn1Notifications', equals: 100}, {metric: 'fanIn1Value', equals: 100},
        ],
    },
    {
        id: 'computed/pulls@128', improvement: 'R15', scenario: 'computed/pulls', args: [128, 10000],
        gates: [
            {metric: 'pullsMs', max: 10}, {metric: 'pullsMs', scale: {from: 'computed/pulls@1'}, max: 30},
            {metric: 'stableEvals', equals: 0}, {metric: 'unrelatedEvals', equals: 0},
            {metric: 'changedEvals', equals: 1}, {metric: 'value', equals: 129},
            {metric: 'fanIn10Notifications', equals: 100}, {metric: 'fanIn10Value', equals: 1045},
            {metric: 'fanIn100Notifications', equals: 100}, {metric: 'fanIn100Value', equals: 14950},
        ],
    },
    {
        id: 'computed/freshness@1-native', improvement: 'control', scenario: 'computed/freshness',
        args: ['native', 1, 20, 400],
        gates: counters,
    },
    {
        id: 'computed/freshness@12-native', improvement: 'control', scenario: 'computed/freshness',
        args: ['native', 12, 20, 400],
        gates: counters,
    },
    {
        id: 'computed/freshness@12-external', improvement: 'R10-04', scenario: 'computed/freshness',
        args: ['external', 12, 20, 400],
        gates: counters,
    },
    {
        id: 'computed/hook-publication@100', improvement: 'R10-03', scenario: 'computed/hook-publication',
        args: [100, 10],
        gates: [
            {metric: 'primitiveRenders', equals: 1000}, {metric: 'primitiveText', equals: '100:10'},
            {metric: 'mapAnnouncements', equals: 10},
            {metric: 'mapRenders', equals: 1000}, {metric: 'mapText', equals: '100:10'},
            {metric: 'mapDistinctValues', equals: 1},
            {metric: 'envelopeRenders', equals: 1000}, {metric: 'envelopeText', equals: '100:10'},
            {metric: 'envelopeDistinctValues', equals: 1},
        ],
    },
    {
        id: 'computed/hook-publication@1000', improvement: 'R10-03', scenario: 'computed/hook-publication',
        args: [1000, 10],
        gates: [
            {metric: 'mapAnnouncements', equals: 10},
            {metric: 'mapRenders', equals: 10000}, {metric: 'mapText', equals: '1000:10'},
            {metric: 'mapDistinctValues', equals: 1},
            {metric: 'envelopeRenders', equals: 10000}, {metric: 'envelopeText', equals: '1000:10'},
            {metric: 'envelopeDistinctValues', equals: 1},
        ],
    },
    // PG-C1
    {
        id: 'computed/diamond-ladder@26', improvement: 'JS-R16-06',
        scenario: 'computed/pg-c1/diamond-ladder',
        gates: [{metric: 'marks', max: 120}, {metric: 'bodyRuns', equals: 26}],
    },
    {
        id: 'computed/diamond-ladder@26-control', improvement: 'control',
        scenario: 'computed/pg-c1/diamond-ladder',
        gates: [
            {metric: 'controlMarks', min: 1}, {metric: 'controlBodyRuns', equals: 26},
            {metric: 'everyBodyOnce', equals: true}, {metric: 'controlEveryBodyOnce', equals: true},
            {metric: 'initialValue', equals: 75025}, {metric: 'value', equals: 196418},
            {metric: 'controlValue', equals: 317811}, {metric: 'resultChanged', equals: true},
        ],
    },
    ...[1000, 4000].flatMap(rows => [
        {
            id: `computed/live-list@${rows / 1000}k`, improvement: 'JS-R14-01',
            scenario: 'computed/pg-c1/live-list', args: [rows],
            gates: [
                {metric: 'subscribeCalls', equals: 1},
                {metric: 'extendCalls', min: 1}, {metric: 'extendCalls', max: rows},
            ],
        },
        {
            id: `computed/live-list@${rows / 1000}k-control`, improvement: 'control',
            scenario: 'computed/pg-c1/live-list', args: [rows],
            gates: [
                {metric: 'mountSubscribeCalls', min: 1},
                {metric: 'mountBodyRuns', equals: 1}, {metric: 'mountRenders', equals: 1},
                {metric: 'mountTextCorrect', equals: true},
                {metric: 'bodyRuns', equals: 1}, {metric: 'renders', equals: 1},
                {metric: 'textCorrect', equals: true},
            ],
        },
    ]),
    // PG-C2
    // Observed --runs 3: 2768ed631237: equalsEqualRenders 20 -> 0; equal body 1; no-equals renders 20; changed renders 20.
    {
        id: 'computed/equals-list@20', improvement: 'JS-R15-03',
        scenario: 'computed/pg-c2/equals-list',
        gates: [
            {metric: 'equalsMountOnce', equals: true},
            {metric: 'equalsEqualRenders', equals: 0},
            {metric: 'equalsEqualBodies', equals: 1},
            {metric: 'equalsChangedOnce', equals: true},
            {metric: 'equalsChangedRenders', equals: 20},
            {metric: 'equalsChangedBodies', equals: 1},
            {metric: 'identityMountOnce', equals: true},
            {metric: 'identityEqualRenders', equals: 20},
            {metric: 'identityEqualBodies', equals: 1},
            {metric: 'identityChangedOnce', equals: true},
            {metric: 'identityChangedRenders', equals: 20},
            {metric: 'identityChangedBodies', equals: 1},
            {metric: 'done', equals: true},
        ],
    },
    // PG-B1: f19f6f074877 pulls 5000 -> 0; cold control 6 -> 7, empty 0; six runs x3 pass.
    {
        id: 'computed/hook-publication-keys@1000', improvement: 'JS-R13-04',
        scenario: 'computed/hook-publication', args: [1000, 10],
        gates: [{metric: 'pullKeys', equals: 0}, {metric: 'pullValue', equals: 5}],
    },
    {
        id: 'computed/hook-publication-keys-control@1000', improvement: 'control',
        scenario: 'computed/hook-publication', args: [1000, 10],
        gates: [{metric: 'controlPullKeys', min: 1}, {metric: 'emptyPullKeys', equals: 0}],
    },
]
