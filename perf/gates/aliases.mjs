/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Native aliases: reflection counters cover descriptor primitives and positive row controls.
// ce08c7f contains R19-ENGINE-02 and is b33be10's parent (R19-ENGINE-01).
// e41828a41747 is 470a912's parent (scalar-write index retention).
// R30 repeat-selection and warmed iteration have their own pre-R30 baseline.
export default [
    {
        id: 'aliases/read-cache@10k', improvement: 'R30-01', scenario: 'aliases/read-cache', args: [10000],
        gates: [
            {metric: 'viewIterateMs', over: 'rawIterateMs', max: 1.5},
            {metric: 'payloadOk', equals: true}, {metric: 'iterateOk', equals: true},
        ],
    },
    {
        id: 'aliases/selection-visits@128', improvement: 'R19-ENGINE-01', scenario: 'aliases/selection-visits', args: [128],
        gates: [
            // Current: 130; cap leaves 30 visits of slack and rejects the audit's 256.
            {metric: 'firstRootVisits', max: 160},
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
        id: 'aliases/write-read@4k', improvement: '470a912', scenario: 'aliases/write-read', args: [4000, 64],
        gates: [
            {metric: 'rootVisits', max: 150},
            {metric: 'rowVisits', min: 4000}, {metric: 'rowVisits', max: 12000},
            {metric: 'pathsOk', equals: true}, {metric: 'writeLanded', equals: true},
            {metric: 'intact', equals: true},
        ],
    },
];
