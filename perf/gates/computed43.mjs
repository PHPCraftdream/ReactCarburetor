const verdicts = names => names.map(metric => ({metric, equals: true}));
const sizes = [1, 4, 16, 64].flatMap(K => [4, 16, 64].map(M => [K, M])).concat([[8, 8]]);
const layouts = ['bare-first', 'merged-first', 'distinct'];

export default [{
    id: 'computed43/equality-failure-acceptance', improvement: 'R43-C01',
    scenario: 'computed43/equality-failure-acceptance',
    gates: [{metric: 'caseCount', equals: 22}, {metric: 'emptyBodies', equals: 1},
        {metric: 'emptyCalls', equals: 0},
        ...verdicts(['acceptanceCorrect', 'exactErrors', 'exactArguments', 'tokensCorrect',
            'cachedQuiet', 'observedCorrect', 'done'])],
}, ...sizes.flatMap(([K, M]) => layouts.map(layout => {
    const initial = K * M * (M + 1) / 2 + K * (K - 1) / 2;
    return {
        id: `computed43/repeated-borrowed-group@K${K}-M${M}-${layout}`,
        improvement: layout === 'bare-first' ? 'R43-C02' : 'control',
        scenario: 'computed43/repeated-borrowed-group', args: [String(K), String(M), layout],
        gates: [{metric: 'initial', equals: initial}, {metric: 'current', equals: initial + 1},
            {metric: 'final', equals: initial + 1 + K}, {metric: 'pairs', equals: M + 1},
            {metric: 'commonProbes', equals: layout === 'distinct' ? 0 : M},
            {metric: 'positiveProbes', equals: M}, {metric: 'emptyProbes', equals: 0},
            {metric: 'bodyRuns', equals: 2}, {metric: 'groupRuns', equals: 1},
            {metric: 'aliasRuns', equals: K}, {metric: 'leafRuns', equals: M},
            {metric: 'deliveries', equals: 1}, {metric: 'deliveryChecksum', equals: initial + 1},
            ...verdicts(['pairCoverage', 'orderCorrect', 'snapshotsIntact', 'noiseQuiet',
                'commonUpdateCorrect', 'done'])],
    };
})), ...sizes.flatMap(([K, M]) => layouts.map(layout => {
    const initial = K * M * (M + 1) / 2 + K * (K - 1) / 2;
    const checksum = 112 * initial + (9 + 120) * 112 / 2;
    return {
        id: `computed43/repeated-borrowed-timing@K${K}-M${M}-${layout}`,
        improvement: layout === 'bare-first' ? 'R43-C02' : 'control',
        scenario: 'computed43/repeated-borrowed-timing', args: [String(K), String(M), layout],
        gates: [{metric: 'initial', equals: initial}, {metric: 'writes', equals: 112},
            {metric: 'checksum', equals: checksum}, {metric: 'deliveryChecksum', equals: checksum},
            {metric: 'bodies', equals: 112}, {metric: 'deliveries', equals: 112},
            ...verdicts(['correct', 'upstreamQuiet', 'noiseQuiet', 'done'])],
    };
})), {
    id: 'computed43/observed-equal-source-lifetime', improvement: 'R43-C03',
    scenario: 'computed43/observed-equal-source-lifetime',
    gates: [{metric: 'caseCount', equals: 6}, {metric: 'gcRounds', equals: 16},
        {metric: 'childTimeoutMs', equals: 30000},
        ...verdicts(['equalCollected', 'equalPayloadCollected', 'checkpointRetired', 'controlsCorrect',
            'ownersAlive', 'retiredQuiet', 'replacementCorrect', 'releaseCorrect', 'projectionIdentity',
            'heldResultLive', 'done'])],
}, {
    id: 'computed43/cheap-controls', improvement: 'control', scenario: 'computed43/cheap-controls',
    gates: [{metric: 'positiveMaps', equals: 1}, {metric: 'positiveSets', equals: 1},
        {metric: 'overBudgetMaps', equals: 2}, {metric: 'overBudgetSets', equals: 4},
        {metric: 'equalTickMaps', max: 1}, {metric: 'equalTickSets', max: 3},
        ...['emptyMaps', 'emptySets', 'cachedMaps', 'cachedSets', 'deliveries'].map(metric => ({metric, equals: 0})),
        {metric: 'bodies', equals: 114}, {metric: 'emptyBodies', equals: 1}, {metric: 'ticks', equals: 113},
        ...verdicts(['overBudgetMapsRejected', 'overBudgetSetsRejected',
            'tinyCorrect', 'noCollisionConstructors', 'singleCollisionConstructors', 'done'])],
}];
