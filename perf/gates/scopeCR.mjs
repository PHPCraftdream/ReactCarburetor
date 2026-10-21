export default [{
    id: 'scopeCR/child-delegation', improvement: 'control', scenario: 'scopeCR/child-delegation',
    gates: [
        {metric: 'localRootCalls', equals: 0},
        {metric: 'localFactories', equals: 1},
        {metric: 'delegatedParentCalls', equals: 1},
        {metric: 'parentFactories', equals: 1},
        {metric: 'positiveControlCalls', equals: 10},
        {metric: 'correct', equals: true},
    ],
}];
