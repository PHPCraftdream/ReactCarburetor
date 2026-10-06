/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Live computed results. Values and run counts are exact; getMs is a generous ceiling on the per-pull
// identity check added with the fix.
export default [
    {
        id: 'liveresult/replace-data@10k', improvement: 'R35-01', scenario: 'liveresult/replace-data',
        args: [10000, 200],
        gates: [
            {metric: 'seenAfterSetData', equals: 'set'}, {metric: 'seenAfterFromJson', equals: 'json'},
            {metric: 'liveRunsOnSetData', equals: 1}, {metric: 'primitiveRunsOnSetData', equals: 0},
            {metric: 'seenAfterEdit', equals: 'again'}, {metric: 'getMs', max: 0.5},
        ],
    },
];
