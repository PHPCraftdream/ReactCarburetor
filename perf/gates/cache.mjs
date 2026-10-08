/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Cache. R31-02: settled `forgetAll` is one ownership pass at every matrix size; the 32/128
// entries fall on pre-R31 builds (roots 32/128, 496/8128 omitted-entry visits, ~15/324 ms), the
// larger sizes by construction. The fallbacks entry controls writable/mixed removal;
// R8-03/R9-04 publication counters live in the PG-HEAP entries below.
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
    // PG-C1
    // JS-R16-04 baseline/current cold work: 1k 1500500/1515, 4k 24002000/6363;
    // scale 16.00/4.20; cold dictionary calls 2000/0 and 8000/0. Hits: zero on both.
    ...[1000, 4000].flatMap(count => {
        const size = count === 1000 ? '1k' : '4k';
        const scenario = 'cache/pg-c1/eviction-scaling';
        return [
            {
                id: `cache/eviction-scaling@${size}`, improvement: 'JS-R16-04', scenario, args: [count],
                gates: [
                    {metric: 'coldDictionaryCalls', equals: 0},
                    {metric: 'coldWorkPerLoad', max: 3},
                    {metric: 'hitDictionaryCalls', equals: 0}, {metric: 'hitDictionaryVisits', equals: 0},
                    {metric: 'hitLedgerVisits', equals: 0}, {metric: 'hitWork', equals: 0},
                    ...(count === 4000 ? [
                        {metric: 'coldWork', scale: {from: 'cache/eviction-scaling@1k'}, max: 4.4},
                    ] : []),
                ],
            },
            {
                id: `cache/eviction-scaling@${size}-control`, improvement: 'control', scenario, args: [count],
                gates: [
                    {metric: 'coldWork', min: 1},
                    {metric: 'probeDictionaryCalls', equals: 1},
                    {metric: 'probeDictionaryVisits', equals: count}, {metric: 'probeLedgerVisits', equals: count},
                    {metric: 'idleDictionaryCalls', equals: 0}, {metric: 'idleLedgerVisits', equals: 0},
                    {metric: 'loaderCalls', equals: count}, {metric: 'hitLoaderCalls', equals: 0},
                    {metric: 'remainingEntries', equals: count}, {metric: 'done', equals: true},
                ],
            },
        ];
    }),
    // PG-HEAP
    // R8-03 (8b27dc42ac2f): writes/version/callbacks 4000 -> 1; controls 1/idle 0.
    // R9-04 (a67911e6c23b): writes/version/callbacks 4000 -> 1; 4001 signals aborted.
    ...['forget', 'abort'].flatMap(operation => {
        const id = operation === 'forget' ? 'cache/forget-all@4000-persist' : 'cache/abort-all@4000';
        const scenario = 'cache/pg-heap/bulk-publications';
        const args = [4000, operation];
        return [
            {
                id, improvement: operation === 'forget' ? 'R8-03' : 'R9-04', scenario, args,
                gates: [
                    ...(operation === 'forget' ? [{metric: 'persistForgetWrites', equals: 1}] : [
                        {metric: 'versionDeltaAbort', equals: 1}, {metric: 'storageWritesAbort', equals: 1},
                    ]),
                    {metric: 'publicationDelta', equals: 1}, {metric: 'subscriberCalls', equals: 1},
                ],
            },
            {
                id: `${id}-control`, improvement: 'control', scenario, args,
                gates: [
                    {metric: 'positiveWrites', equals: 1}, {metric: 'positiveVersion', equals: 1},
                    {metric: 'positiveCallbacks', equals: 1},
                    {metric: 'idleWrites', equals: 0}, {metric: 'idleVersion', equals: 0},
                    {metric: 'idleCallbacks', equals: 0},
                    {metric: 'repeatWrites', equals: 0}, {metric: 'repeatVersion', equals: 0},
                    {metric: 'repeatCallbacks', equals: 0},
                    {metric: 'remainingEntries', equals: operation === 'abort' ? 4001 : 0},
                    {metric: 'abortedSignals', equals: operation === 'abort' ? 4001 : 0},
                    {metric: 'loaderCalls', equals: operation === 'abort' ? 4001 : 0},
                    {metric: 'done', equals: true},
                ],
            },
        ];
    }),
]
