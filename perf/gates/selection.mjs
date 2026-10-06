/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Selection. The mechanism gates are counters: descriptor walks per key are the pre-R30-04 cost,
// Object.keys/Reflect.ownKeys on a live view is the pre-R33-04 cost (probeSelfCount proves the
// enumeration probe still counts), and an unchanged detached Date answering "changed" is the
// pre-R30-03 behavior. Negative verdicts keep an always-equal comparison from passing.
// The old absolute microsecond caps were machine-specific and are deliberately not ported.
export default [
    {
        id: 'selection/compare@plain', improvement: 'R30-04', scenario: 'selection/model', args: [200000, 11, 'plain'],
        gates: [
            {metric: 'compareDescriptorVisits', equals: 0}, {metric: 'detachDescriptorVisits', equals: 0},
            {metric: 'samePlain', equals: true},
            {metric: 'differentTitle', equals: false},
            {metric: 'differentPayload', equals: false},
            {metric: 'differentKeyOrder', equals: false},
            {metric: 'differentKeyCount', equals: false},
            {metric: 'differentClassInstance', equals: false},
            {metric: 'detachIndependent', equals: true},
            {metric: 'detachRoundtrip', equals: true},
        ],
    },
    {
        id: 'selection/date-equal', improvement: 'R30-03', scenario: 'selection/model', args: [100000, 11, 'date'],
        gates: [
            {metric: 'dateVerdict', equals: true}, {metric: 'dateChangedVerdict', equals: false},
            {metric: 'dateDescriptorVisits', equals: 0},
        ],
    },
    {
        id: 'selection/keys-hatch@10k', improvement: 'R33-04', scenario: 'selection/keys-hatch', args: [10000, 12],
        gates: [
            {metric: 'sameKeysOnViews', equals: 0}, {metric: 'detachKeysOnViews', equals: 0},
            {metric: 'probeSelfCount', equals: 2},
            {metric: 'sameVerdict', equals: true}, {metric: 'detachOk', equals: true},
        ],
    },
];
