export default [{
    id: 'dev/unpublished-draft', improvement: 'control', scenario: 'dev/unpublished-draft', args: [],
    gates: [
        // One reused diagnostic callback across cycles; minting one per cycle fails here.
        {metric: 'distinctCallbacks', equals: 1},
        {metric: 'queued', min: 1},
        {metric: 'deliveries', equals: 9}, {metric: 'warnings', equals: 1},
        {metric: 'finalN', equals: 9}, {metric: 'done', equals: true},
    ],
}];
