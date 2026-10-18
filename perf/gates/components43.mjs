export default [
    ...[1, 4, 8].map(count => ({
        id: `components43/tracked-route-lifetime@${count}`, improvement: 'R43-A01',
        scenario: 'components43/tracked-route-lifetime', args: [String(count)],
        gates: [{metric: 'retained', equals: 0}, {metric: 'controls', equals: 2},
            {metric: 'lanes', equals: 11}, {metric: 'warmChurn', equals: 0}],
    })),
    {id: 'components43/lifecycle', improvement: 'R43-A01', scenario: 'components43/lifecycle', args: [],
        gates: [{metric: 'lanes', equals: 16}, {metric: 'releasedOwners', equals: 0}]},
    {id: 'components43/render-commit@1k', improvement: 'R43-A01',
        scenario: 'components43/render-commit', args: [],
        gates: [{metric: 'iterations', equals: 1000}, {metric: 'checksum', equals: 2209},
            {metric: 'delivered', equals: 1}, {metric: 'warmChurn', equals: 0}]},
];
