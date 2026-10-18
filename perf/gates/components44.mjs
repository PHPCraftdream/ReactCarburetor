export default [
    ...[1, 4, 8].map(count => ({
        id: `components44/selection-attribution-lifetime@${count}`, improvement: 'R44-A01',
        scenario: 'components44/selection-attribution-lifetime', args: [String(count)],
        gates: [{metric: 'retained', equals: 0}, {metric: 'lanes', equals: 6},
            {metric: 'controls', equals: 3}, {metric: 'hiddenWritesSilent', equals: true},
            {metric: 'rearmDelivered', equals: true}, {metric: 'warmChurn', equals: 0},
            {metric: 'activeAfterTeardown', equals: 0}],
    })),
    {id: 'components44/render-commit', improvement: 'R44-A01',
        scenario: 'components44/render-commit', args: [],
        gates: [{metric: 'iterations', equals: 1000}, {metric: 'checksum', equals: 2209},
            {metric: 'warmChurn', equals: 0}]},
];
