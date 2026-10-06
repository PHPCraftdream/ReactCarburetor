/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Components. Render counts, rendered text and the instance/proxy shapes are exact; mount cost
// is bounded by the 4k/1k size scale and SSR by the in-process rows/(rows/4) ratio.
// mount-edit is a correctness control (the old benchmark was a non-regression A/B).
export default [
    {
        id: 'components/mount-edit@1k', improvement: 'control', scenario: 'components/mount-edit', args: [1000, 5],
        gates: [
            {metric: 'rowRendersPerEdit', equals: 1}, {metric: 'pageRendersPerReplace', equals: 1},
            {metric: 'text', equals: 'edited-4|1000'},
        ],
    },
    {
        id: 'components/mount-edit@4k', improvement: 'control', scenario: 'components/mount-edit', args: [4000, 5],
        gates: [
            {metric: 'rowRendersPerEdit', equals: 1}, {metric: 'pageRendersPerReplace', equals: 1},
            {metric: 'mountMs', scale: {from: 'components/mount-edit@1k'}, max: 18},
            {metric: 'text', equals: 'edited-4|4000'},
        ],
    },
    {
        id: 'components/ssr@4k', improvement: 'R13-06', scenario: 'components/ssr', args: [4000, 3],
        gates: [
            {metric: 'instanceMethodFields', equals: 0},
            {metric: 'hasLastRow', equals: true}, {metric: 'htmlChars', min: 60000},
            {metric: 'ssrLargeMs', over: 'ssrSmallMs', max: 6},
        ],
    },
    {
        id: 'components/proxy-reads', improvement: 'R13-10', scenario: 'components/proxy-reads', args: [200],
        gates: [
            {metric: 'steadyRenders', equals: 200},
            {metric: 'steadyReadCalls', equals: 0}, {metric: 'steadyViews', equals: 0},
            {metric: 'changedRenders', equals: 1}, {metric: 'changedReadCalls', equals: 1},
            {metric: 'unreadRenders', equals: 0},
            {metric: 'text', equals: '7'}, {metric: 'sinkPositive', equals: true},
        ],
    },
]
