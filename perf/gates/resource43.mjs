export default [
    {
        id: 'resource43/cancel-frees-eviction', improvement: 'R43-R01',
        scenario: 'resource43/cancel-frees-eviction', args: [],
        gates: [
            // 3 capacities * 2 refresh states * 2 TTLs * 2 modes + 4 protected lanes.
            {metric: 'lanes', equals: 3 * 2 * 2 * 2 + 4},
            {metric: 'missedReclaims', equals: 0},
            {metric: 'eagerScans', equals: 0},
            // Every unprotected lane scans; only the 2 protected abortAll lanes release victims.
            {metric: 'nextScans', equals: 3 * 2 * 2 * 2 + 2},
            // abort visits capacity + 2; abortAll visits 2. Protected abortAll visits 3 each.
            {metric: 'nextVisits', equals: 2 * 2 * ((1 + 2 + 2) + (2 + 2 + 2) + (8 + 2 + 2)) + 2 * 3},
            {metric: 'settlementControls', equals: 2},
            {metric: 'departureControls', equals: 1},
            {metric: 'cheapVisits', equals: 0},
            // Each of the 3 controls initially scans 2 retained requests.
            {metric: 'positiveVisits', equals: 3 * 2},
            {metric: 'controlScans', equals: 5},
            {metric: 'controlVisits', equals: 8},
            {metric: 'unrelatedDeliveries', equals: 0},
            {metric: 'retryControls', equals: 1},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'resource43/key-work', improvement: 'R43-R02',
        scenario: 'resource43/key-work', args: [],
        gates: [
            {metric: 'objectStringifies', equals: 16},
            {metric: 'freshObjectStringifies', equals: 16},
            // The gate harness runs scenarios with NODE_ENV=production.
            {metric: 'mutationWarnings', equals: 0},
            {metric: 'emptyStringifies', equals: 0},
            {metric: 'disabledStringifies', equals: 4},
            {metric: 'budgetOneStringifies', equals: 4},
            {metric: 'lruStringifies', equals: 4},
            {metric: 'withinBudgetStringifies', equals: 2},
            {metric: 'loaderCalls', equals: 0},
            {metric: 'keysOk', equals: true},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'resource43/object-args-lifetime', improvement: 'R43-R02',
        scenario: 'resource43/object-args-lifetime', args: [],
        gates: [
            {metric: 'cases', equals: 5},
            {metric: 'rootsCollected', equals: 5},
            {metric: 'subtreesCollected', equals: 5},
            {metric: 'capturedArgsCollected', equals: true},
            {metric: 'liveArgsCollected', equals: true},
            {metric: 'capturedDataReleased', equals: true},
            {metric: 'callerAlive', equals: true},
            {metric: 'liveDataAlive', equals: true},
            {metric: 'capturedDataAlive', equals: true},
            {metric: 'unrelatedCollected', equals: true},
            {metric: 'turnoverCollected', equals: true},
            // 5 lifetime cases + turnover + caller/captured/live controls.
            {metric: 'cachesAlive', equals: 5 + 1 + 3},
            {metric: 'loaderCalls', equals: 0},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'resource43/lookup-operations', improvement: 'R43-R02',
        scenario: 'resource43/lookup-operations', args: ['--iterations', '1024'],
        gates: [
            {metric: 'operations', equals: 4096},
            {metric: 'checksum', equals: 31744},
            {metric: 'objectHitMs', min: 0},
            {metric: 'objectMissMs', min: 0},
            {metric: 'primitiveHitMs', min: 0},
            {metric: 'primitiveMissMs', min: 0},
            {metric: 'loaderCalls', equals: 0},
            {metric: 'done', equals: true},
        ],
    },
];
