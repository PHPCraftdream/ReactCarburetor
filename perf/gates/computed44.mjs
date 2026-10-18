const yes = names => names.map(metric => ({metric, equals: true}));
const sizes = [1, 4, 16].flatMap(K => [1, 4, 16].map(M => [K, M]));
const layouts = ['aliases', 'direct', 'distinct', 'external', 'mixed'];

export default [
    ...sizes.flatMap(([K, M]) => layouts.map(layout => {
        const edges = layout === 'direct' ? 1 : K;
        const initial = K * M * (M + 1) / 2 + K * (K - 1) / 2;
        return {
            id: `computed44/repeated-flat-snapshot@K${K}-M${M}-${layout}`,
            improvement: ['aliases', 'mixed', 'external'].includes(layout) && K > 1 ? 'R44-C01' : 'control',
            scenario: 'computed44/repeated-flat-snapshot', args: [K, M, layout],
            gates: [{metric: 'initial', equals: initial}, {metric: 'checksum', equals: 3 * initial + 2 + K},
                {metric: 'inputEdges', equals: 0}, {metric: 'keyCalls', equals: layout === 'distinct' ? K : 1},
                {metric: 'keyEntries', equals: layout === 'distinct' ? K * M : M},
                {metric: 'leafUIDs', equals: layout === 'distinct' ? K * M : M},
                {metric: 'positiveCalls', equals: edges}, {metric: 'positiveEntries', equals: edges * M},
                {metric: 'positiveUIDs', equals: M}, {metric: 'positiveEdges', equals: K},
                ...['emptyEntries', 'cachedEntries', 'noiseEntries'].map(metric => ({metric, equals: 0})),
                {metric: 'leaves', equals: M + 1 + (layout === 'external' ? 1 : 0)},
                {metric: 'callbacks', equals: 2}, {metric: 'publicVersion', equals: 2},
                ...yes(['snapshotsIntact', 'coverage', 'semanticsCorrect', 'done'])],
        };
    })),
    ...sizes.flatMap(([K, M]) => layouts.map(layout => {
        const initial = K * M * (M + 1) / 2 + K * (K - 1) / 2;
        return {
            id: `computed44/repeated-flat-timing@K${K}-M${M}-${layout}`,
            improvement: 'control', scenario: 'computed44/repeated-flat-timing', args: [K, M, layout],
            gates: [{metric: 'writes', equals: 112}, {metric: 'checksum', equals: 112 * initial + 7224},
                {metric: 'publicVersion', equals: 120}, {metric: 'noiseValue', equals: initial + 120},
                {metric: 'noiseVersion', equals: 120},
                ...yes(['snapshotsIntact', 'validationCorrect', 'correct', 'done'])],
        };
    })),
    ...[1, 8, 32].flatMap(M => ['changed', 'equal', 'downstream', 'unobserved'].map(lane => ({
        id: `computed44/observed-baseline-eligibility@M${M}-${lane}`,
        improvement: lane === 'unobserved' ? 'control' : 'R44-C02',
        scenario: 'computed44/observed-baseline-eligibility', args: [M, lane],
        gates: [{metric: 'preBodyCalls', equals: 0}, {metric: 'preBodyEntries', equals: 0},
            {metric: 'positiveCalls', equals: 1}, {metric: 'positiveEntries', equals: M},
            {metric: 'captureValueCalls', equals: 0}, {metric: 'captureValueEntries', equals: 0},
            {metric: 'positiveValueCalls', equals: 1}, {metric: 'positiveValueEntries', equals: M},
            {metric: 'coldCalls', equals: 1}, {metric: 'coldEntries', equals: 0},
            ...['cachedCalls', 'emptyCalls', 'validCalls'].map(metric => ({metric, equals: 0})),
            {metric: 'releasedCalls', equals: lane === 'unobserved' ? 0 : 1},
            {metric: 'releasedEntries', equals: lane === 'unobserved' ? 0 : M},
            {metric: 'bodies', equals: 3},
            {metric: 'callbacks', equals: ['equal', 'unobserved'].includes(lane) ? 0 : 1},
            {metric: 'publicVersion', equals: ['equal', 'unobserved'].includes(lane) ? 0 : 1},
            {metric: 'checksum', equals: lane === 'equal' ? 3 : 3 * M + 6},
            ...yes(['semanticsCorrect', 'done'])],
    }))),
    ...[1, 8, 32].flatMap(M => ['changed', 'equal', 'downstream', 'unobserved', 'cached'].map(lane => {
        const constant = ['equal', 'cached'].includes(lane);
        const versionDelta = constant || lane === 'unobserved' ? 0 : 112;
        const checksum = constant ? 112 * (lane === 'cached' ? M : 1)
            : (112 * M + 7224) * (lane === 'downstream' ? 2 : 1);
        return {
            id: `computed44/observed-baseline-timing@M${M}-${lane}`, improvement: 'control',
            scenario: 'computed44/observed-baseline-timing', args: [M, lane],
            gates: [{metric: 'operations', equals: 112}, {metric: 'checksum', equals: checksum},
                {metric: 'finalValue', equals: constant ? (lane === 'cached' ? M : 1)
                    : (M + 120) * (lane === 'downstream' ? 2 : 1)},
                {metric: 'versionDelta', equals: versionDelta},
                ...yes(['validationCorrect', 'correct', 'done'])],
        };
    })),
    ...['constant', 'empty'].map(lane => ({
        id: `computed44/cheap-timing-${lane}`, improvement: 'control',
        scenario: 'computed44/observed-baseline-timing', args: [1, lane],
        gates: [{metric: 'operations', equals: 112}, {metric: 'checksum', equals: 112},
            {metric: 'finalValue', equals: 1}, {metric: 'versionDelta', equals: 0},
            ...yes(['validationCorrect', 'correct', 'done'])],
    })),
    {id: 'computed44/controls', improvement: 'control', scenario: 'computed44/controls',
        gates: [{metric: 'cases', equals: 4}, ...yes(['mixedFormats', 'branchMigration', 'eagerTransaction',
            'overlapPreserved', 'changedProtocol', 'capturedVersions', 'correct', 'done'])]},
];
