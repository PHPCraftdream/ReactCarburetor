const verdicts = names => names.map(metric => ({metric, equals: true}));

export default [{
    id: 'computed42/merged-pair-freshness', improvement: 'R42-C01',
    scenario: 'computed42/merged-pair-freshness',
    gates: [{metric: 'caseCount', equals: 32}, {metric: 'checksum', equals: 1680},
        ...verdicts(['freshness', 'deliveriesCorrect', 'noiseQuiet', 'bodiesCorrect',
            'snapshotsIntact', 'completePairs', 'done'])],
}, {
    id: 'computed42/undefined-equals', improvement: 'R42-C03', scenario: 'computed42/undefined-equals',
    gates: [{metric: 'caseCount', equals: 8}, {metric: 'coldCalls', equals: 0},
        ...verdicts(['exactArguments', 'baselineRetained', 'versionsCorrect', 'deliveriesCorrect',
            'bodiesCorrect', 'noiseQuiet', 'sameReferenceCorrect', 'done'])],
}, ...[100, 400, 1600].flatMap(K => ['shared', 'distinct'].map(layout => {
    const initial = K * (K - 1) / 2;
    return {
        id: `computed42/fan-in-part-work@${K}-${layout}`,
        improvement: layout === 'shared' ? 'R42-C02' : 'control',
        scenario: 'computed42/fan-in-part-work', args: [String(K), layout],
        gates: [{metric: 'initial', equals: initial}, {metric: 'current', equals: initial + 1},
            {metric: 'finalPairs', equals: K}, {metric: 'bodyRuns', equals: 2},
            {metric: 'leafRuns', equals: K + 1}, {metric: 'deliveries', equals: 1},
            {metric: 'deliveryChecksum', equals: initial + 1},
            {metric: 'partRefs', max: layout === 'shared' ? 4 * K : 0},
            ...(layout === 'shared' ? [{metric: 'partRefs', min: K}] : []),
            {metric: 'emptyRefs', equals: 0}, {metric: 'spreadControlRefs', equals: 2},
            {metric: 'appendControlRefs', equals: 2}, {metric: 'copyControlRefs', equals: 2},
            ...verdicts(['pairCoverage', 'snapshotsIntact', 'noiseQuiet', 'methodsCovered', 'done'])],
    };
})), ...[100, 400, 1600].flatMap(K => ['shared', 'distinct'].map(layout => {
    const initial = K * (K - 1) / 2;
    const timingChecksum = 112 * initial + (9 + 120) * 112 / 2;
    return {
        id: `computed42/fan-in-timing@${K}-${layout}`,
        improvement: layout === 'shared' ? 'R42-C02' : 'control',
        scenario: 'computed42/fan-in-timing', args: [String(K), layout],
        gates: [{metric: 'initial', equals: initial}, {metric: 'timingWrites', equals: 112},
            {metric: 'timingChecksum', equals: timingChecksum},
            {metric: 'timingDeliveryChecksum', equals: timingChecksum},
            {metric: 'timingBodyRuns', equals: 112}, {metric: 'timingLeafRuns', equals: 112},
            {metric: 'timingDeliveries', equals: 112},
            ...verdicts(['timingCorrect', 'timingNoiseQuiet', 'done'])],
    };
}))];
