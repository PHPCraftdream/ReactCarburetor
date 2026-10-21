export default [{
    id: 'actionCR/publication', improvement: 'control', scenario: 'actionCR/publication', args: [],
    gates: [
        {metric: 'singleActionEmits', equals: 1}, {metric: 'singleActionDeliveries', equals: 1},
        {metric: 'nestedActionEmits', equals: 1}, {metric: 'nestedActionDeliveries', equals: 1},
        {metric: 'singleBaselineEmits', equals: 1}, {metric: 'singleBaselineDeliveries', equals: 1},
        {metric: 'nestedBaselineEmits', equals: 1}, {metric: 'nestedBaselineDeliveries', equals: 1},
        {metric: 'positiveControlEmits', equals: 2}, {metric: 'positiveControlDeliveries', equals: 2},
        {metric: 'singleActionCollections', over: 'singleUpdateCollections', max: 1},
        {metric: 'nestedActionCollections', over: 'nestedUpdateCollections', max: 1},
        {metric: 'constructorControlCollections', min: 2},
    ],
}];
