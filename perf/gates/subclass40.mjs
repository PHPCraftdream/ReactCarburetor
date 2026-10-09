export default [{
    id: 'subclass40/store-identities', improvement: 'R40-01',
    scenario: 'subclass40/identities', args: [],
    gates: [
        {metric: 'titles', equals: 'A,B,C,D'}, {metric: 'version', equals: 3},
        {metric: 'directDeliveries', equals: 3}, {metric: 'domainVersion', equals: 7},
        {metric: 'initialPair', equals: 'me & friend'}, {metric: 'finalPair', equals: 'me & friend2'},
        {metric: 'deliveries', equals: 1}, {metric: 'delivered', equals: 'me & friend2'},
        {metric: 'domainUIDsEqual', equals: true}, {metric: 'done', equals: true},
    ],
}, {
    id: 'subclass40/store-names', improvement: 'R40-01',
    scenario: 'subclass40/names', args: [],
    gates: [
        {metric: 'ownNames', equals: 0}, {metric: 'correct', equals: 28},
        {metric: 'controls', equals: 28}, {metric: 'cases', equals: 28}, {metric: 'done', equals: true},
    ],
}, {
    id: 'subclass40/resource-names', improvement: 'R40-01',
    scenario: 'subclass40/resources', args: [],
    gates: [
        {metric: 'cacheOwn', equals: 0}, {metric: 'slotOwn', equals: 0},
        {metric: 'cacheCorrect', equals: 7}, {metric: 'slotCorrect', equals: 5},
        {metric: 'controls', equals: 12}, {metric: 'done', equals: true},
    ],
}, {
    id: 'subclass40/component-delivery', improvement: 'R40-01',
    scenario: 'subclass40/components', args: [],
    gates: [
        {metric: 'ownNames', equals: 0}, {metric: 'before', equals: 'AdaAdAda'},
        {metric: 'pair', equals: 'GraceGr'}, {metric: 'control', equals: 'Grace'},
        {metric: 'nameRenders', equals: 2}, {metric: 'avatarRenders', equals: 2},
        {metric: 'done', equals: true},
    ],
}, {
    id: 'subclass40/write-cost', improvement: 'R40-01',
    scenario: 'subclass40/write-cost', args: [],
    gates: [
        {metric: 'deliveries', equals: 1000}, {metric: 'writes', equals: 1000},
        {metric: 'size', equals: 1000}, {metric: 'writeMs', over: 'controlMs', max: 30},
        {metric: 'done', equals: true},
    ],
}];
