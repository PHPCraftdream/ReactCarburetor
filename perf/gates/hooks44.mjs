export default [
    {id: 'hooks44/computed-snapshot-lifetime', improvement: 'R44-A02',
        scenario: 'hooks44/computed-snapshot-lifetime', args: [],
        gates: [{metric: 'retained', equals: 0}, {metric: 'ssrLanes', equals: 4},
            {metric: 'clientLanes', equals: 4}, {metric: 'controls', equals: 3},
            {metric: 'activeAfterTeardown', equals: 0}]},
    ...[1, 4, 8].flatMap(count => ['native', 'external'].map(kind => ({
        id: `hooks44/multi-consumer@${count}-${kind}`, improvement: 'R44-A02',
        scenario: 'hooks44/multi-consumer', args: [String(count), kind],
        gates: [{metric: 'consumers', equals: count}, {metric: 'publications', equals: 20},
            {metric: 'checks', equals: 1000},
            {metric: 'checksMs', min: 0}, {metric: 'publicationsMs', min: 0}]}))),
    ...[1, 4, 8].flatMap(count => ['native', 'external'].map(kind => ({
        id: `hooks44/snapshot-constructions@${count}-${kind}`, improvement: 'R44-A02',
        scenario: 'hooks44/snapshot-constructions', args: [String(count), kind],
        gates: [{metric: 'consumers', equals: count}, {metric: 'publications', equals: 20},
            {metric: 'initialConstructions', equals: 1}, {metric: 'warmConstructions', equals: 0},
            {metric: 'publicationConstructions', equals: 20},
            {metric: 'weakRefConstructions', equals: 21}, {metric: 'controlConstructions', equals: 1}]}))),
];
