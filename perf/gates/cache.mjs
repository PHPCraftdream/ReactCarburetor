/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Cache. R31-02: settled `forgetAll` is one ownership pass at every matrix size; the 32/128
// entries fall on pre-R31 builds (roots 32/128, 496/8128 omitted-entry visits, ~15/324 ms), the
// larger sizes by construction. The fallbacks entry is a control: its exact counters are
// identical on both sides of the fixes, as is the persist-without-coalesce contract.
export default [
    {
        id: 'cache/forget-all@32-settled', improvement: 'R31-02', scenario: 'cache/forget-all', args: [32, 'settled'],
        gates: [
            {metric: 'roots', equals: 1}, {metric: 'entryVisits', equals: 0}, {metric: 'rowVisits', equals: 0},
            {metric: 'publicationDelta', equals: 1}, {metric: 'remainingEntries', equals: 0},
            {metric: 'subscriberCalls', equals: 1},
        ],
    },
    {
        id: 'cache/forget-all@128-settled', improvement: 'R31-02', scenario: 'cache/forget-all', args: [128, 'settled'],
        gates: [
            {metric: 'roots', equals: 1}, {metric: 'entryVisits', equals: 0}, {metric: 'rowVisits', equals: 0},
            {metric: 'publicationDelta', equals: 1}, {metric: 'remainingEntries', equals: 0},
            {metric: 'subscriberCalls', equals: 1},
            {metric: 'removeMs', max: 30},
        ],
    },
    {
        id: 'cache/forget-all@1000-settled', improvement: 'R31-02', scenario: 'cache/forget-all', args: [1000, 'settled'],
        gates: [
            {metric: 'roots', equals: 1}, {metric: 'entryVisits', equals: 0}, {metric: 'rowVisits', equals: 0},
            {metric: 'publicationDelta', equals: 1}, {metric: 'remainingEntries', equals: 0},
            {metric: 'subscriberCalls', equals: 1},
            {metric: 'removeMs', max: 100},
        ],
    },
    {
        id: 'cache/forget-all@4000-settled', improvement: 'R31-02', scenario: 'cache/forget-all', args: [4000, 'settled'],
        gates: [
            {metric: 'roots', equals: 1}, {metric: 'entryVisits', equals: 0}, {metric: 'rowVisits', equals: 0},
            {metric: 'publicationDelta', equals: 1}, {metric: 'remainingEntries', equals: 0},
            {metric: 'subscriberCalls', equals: 1},
            {metric: 'removeMs', max: 400},
        ],
    },
    {
        id: 'cache/forget-all@32-fallbacks', improvement: 'control', scenario: 'cache/forget-all', args: [32, 'controls'],
        gates: [
            {metric: 'publicationWritable', equals: 1}, {metric: 'remainingWritable', equals: 0},
            {metric: 'rootsWritable', equals: 0},
            {metric: 'publicationMixed', equals: 1}, {metric: 'remainingMixed', equals: 0},
            {metric: 'rootsMixed', equals: 31}, {metric: 'visitsMixed', equals: 465},
            {metric: 'versionDeltaAbort', equals: 1}, {metric: 'callbacksAbort', equals: 1},
            {metric: 'storageWritesAbort', equals: 1}, {metric: 'remainingAbort', equals: 32},
            {metric: 'persistForgetWrites', equals: 1}, {metric: 'persistForgetVersionDelta', equals: 1},
            {metric: 'persistForgetRemaining', equals: 0},
        ],
    },
    {
        id: 'cache/key-memo@4096', improvement: 'R30-08', scenario: 'cache/key-memo', args: ['cycle', 4096],
        gates: [
            {metric: 'coldStringifyCalls', equals: 4096}, {metric: 'stringifyCalls', equals: 0},
            {metric: 'checksum', equals: 8386560},
        ],
    },
    {
        id: 'cache/key-memo@8192-budget', improvement: 'R31-06', scenario: 'cache/key-memo', args: ['cycle', 8192, 8192],
        gates: [
            {metric: 'coldStringifyCalls', equals: 8192}, {metric: 'stringifyCalls', equals: 0},
            {metric: 'checksum', equals: 33550336},
        ],
    },
    {
        id: 'cache/key-memo@hotcold', improvement: 'R31-06', scenario: 'cache/key-memo', args: ['hotcold'],
        gates: [
            {metric: 'warmStringifyCalls', equals: 0}, {metric: 'hotStringifyCalls', equals: 0},
            {metric: 'hotKeysRehit', equals: 8},
        ],
    },
]
