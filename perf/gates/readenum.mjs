/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Read-view key enumeration. keysSeen is the enumerated length the scenario observed. The
// retained-heap ceilings separate the builds at both sizes (~437/1740 KB now against ~723/2890 KB
// with the pre-R32-06 wrappers retained); the over-gate keeps the 10k ceiling V8-independent by
// tying it to the same run's 2.5k control. Times stay for the runner's --against comparison.
export default [
    {
        id: 'readenum/fresh@2500', improvement: 'R32-06', scenario: 'readenum/fresh', args: [2500, 8],
        gates: [
            {metric: 'keysSeen', equals: 2500}, {metric: 'controlKeys', equals: 2500},
            {metric: 'spotOk', equals: true}, {metric: 'retainedKb', max: 580},
        ],
    },
    {
        id: 'readenum/fresh@10000', improvement: 'R32-06', scenario: 'readenum/fresh', args: [10000, 8],
        gates: [
            {metric: 'keysSeen', equals: 10000}, {metric: 'controlKeys', equals: 2500},
            {metric: 'spotOk', equals: true},
            {metric: 'retainedKb', max: 2400},
            {metric: 'retainedKb', over: 'retainedSmallKb', max: 6},
        ],
    },
];
