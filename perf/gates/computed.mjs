/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Computed pulls, freshness and hook delivery. Evaluation, notification and snapshot-record
// counts are the contract; the 128-dependency pull cost is judged against the 1-dependency
// cost (machine independent) with a ceiling far below the pre-fix walk; hook times are generous
// JSDOM ceilings on a shared machine. Guards: R15 per-pull dependency bookkeeping, R10-03 hook
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
            {metric: 'mapMs', max: 20},
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
            {metric: 'mapMs', max: 100},
            {metric: 'mapMs', scale: {from: 'computed/hook-publication@100'}, max: 25},
            {metric: 'envelopeRenders', equals: 10000}, {metric: 'envelopeText', equals: '1000:10'},
            {metric: 'envelopeDistinctValues', equals: 1},
        ],
    },
]
