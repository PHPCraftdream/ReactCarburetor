/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Native aliases. The mechanism gates are reflection counters over BOTH descriptor primitives:
// a root search per keyed Map.get is the pre-R19-ENGINE-01 cost, a discovery re-walk on a repeat
// selection is the pre-R30-01 cost, and a warmed Map view must iterate at raw speed (median of
// alternating samples). The row min gates are positive controls — the probe must be seen to
// count the engine's own reflection, or a blinded zero would pass. Each gate fails on the build
// before its improvement.
export default [
    {
        id: 'aliases/read-cache@10k', improvement: 'R30-01', scenario: 'aliases/read-cache', args: [10000],
        gates: [
            {metric: 'cachedReadMs', max: 0.02}, {metric: 'viewIterateMs', over: 'rawIterateMs', max: 1.5},
            {metric: 'payloadOk', equals: true}, {metric: 'iterateOk', equals: true},
        ],
    },
    {
        id: 'aliases/selection-visits@128', improvement: 'R19-ENGINE-01', scenario: 'aliases/selection-visits', args: [128],
        gates: [
            {metric: 'firstRootVisits', max: 300},
            {metric: 'firstRowVisits', min: 128}, {metric: 'firstRowVisits', max: 320},
            {metric: 'checksumOk', equals: true}, {metric: 'identical', equals: true},
        ],
    },
    {
        id: 'aliases/selection-visits-repeat@128', improvement: 'R30-01', scenario: 'aliases/selection-visits', args: [128],
        gates: [
            {metric: 'secondRootVisits', max: 192}, {metric: 'secondRowVisits', equals: 0},
            {metric: 'identical', equals: true},
        ],
    },
    {
        id: 'aliases/write-read@4k', improvement: 'R19-ENGINE-01', scenario: 'aliases/write-read', args: [4000, 64],
        gates: [
            {metric: 'rootVisits', max: 150},
            {metric: 'rowVisits', min: 4000}, {metric: 'rowVisits', max: 12000},
            {metric: 'pathsOk', equals: true}, {metric: 'writeLanded', equals: true},
            {metric: 'intact', equals: true},
        ],
    },
];
