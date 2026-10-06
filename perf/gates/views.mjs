/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Resource views identity contract (a control, not an improvement guard): unchanged entries
// keep their view across `setData`, a real change republishes once, the same root republishes
// nothing; the replacement/read timings ride the `--against` comparison.
export default [
    {
        id: 'views/set-data-identity@100', improvement: 'control', scenario: 'views/set-data-identity', args: [100],
        gates: [
            {metric: 'sameRootChanged', equals: 0}, {metric: 'versionDeltaSame', equals: 0},
            {metric: 'newRootChanged', equals: 0}, {metric: 'versionDeltaNew', equals: 0},
            {metric: 'oneChangedChanged', equals: 1}, {metric: 'versionDeltaOne', equals: 1},
            {metric: 'value0Same', equals: 0}, {metric: 'value0New', equals: 0},
            {metric: 'value0OneChanged', equals: -1},
        ],
    },
]
