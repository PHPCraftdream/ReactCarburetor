// Independent occupied-slot M / logical-length L axes; no timing ceiling inferred from counters.
export default [[8, 64], [8, 65536], [64, 65536]].flatMap(([m, l]) => [{
    id: `selection44/array-spine-prototype@M${m}-L${l}`, improvement: 'R44-S01',
    scenario: 'selection44/array-spine-prototype', args: [m, l],
    gates: [
        {metric: 'cases', equals: 12}, {metric: 'deliveries', equals: 24},
        {metric: 'scalarDeliveries', equals: 24}, {metric: 'projectedDeliveries', equals: 24},
        {metric: 'unrelatedDeliveries', equals: 0}, {metric: 'positiveArrays', equals: 12},
        {metric: 'diagnostics', equals: 0}, {metric: 'correct', equals: true},
        {metric: 'slotVisits', max: 32 * m + 128},
        {metric: 'ownKeyEntries', max: 24 * (m + 1)},
        {metric: 'positiveSlotVisits', equals: 12},
        {metric: 'positiveOwnKeyEntries', min: 12 * (m + 1)},
    ],
}, {
    id: `selection44/timing@M${m}-L${l}`, improvement: 'R44-S01',
    scenario: 'selection44/timing', args: [m, l],
    gates: [{metric: 'completed', equals: 20736}, {metric: 'canceled', equals: 6912},
        {metric: 'lanes', equals: 24}, {metric: 'samples', equals: 7}, {metric: 'correct', equals: true}],
}]);
