/* oxlint-disable carburetor/max-line-length, carburetor/require-tsdoc */
// Correctness and actual patch spine counts gate; warmed timings are report-only.
export default [{
    id: 'selection43/same-value', improvement: 'R43-S01', scenario: 'selection43/same-value', args: [],
    gates: [
        {metric: 'cases', equals: 45}, {metric: 'deliveries', equals: 27},
        {metric: 'historyReplays', equals: 54}, {metric: 'unrelatedDeliveries', equals: 0},
        {metric: 'freshArrayCases', equals: 10}, {metric: 'freshArrayDeliveries', equals: 18},
        {metric: 'freshArraySharingChecks', equals: 36},
        {metric: 'positiveSpines', equals: 3}, {metric: 'canceledSpines', equals: 0},
        {metric: 'canceledDeliveries', equals: 0}, {metric: 'historyCorrect', equals: true},
        {metric: 'sparseShape', equals: true},
    ],
}].concat(['keyed', 'dense', 'sparse'].flatMap(kind => [16, 128, 512, 4096].map(width => ({
    id: `selection43/timing-${kind}@${width}`, improvement: 'R43-S01',
    scenario: 'selection43/timing', args: [kind, width, 7, 128],
    gates: [
        {metric: 'canceledCallbacks', equals: 0},
        {metric: 'canceledOperations', equals: 1408}, {metric: 'finiteCallbacks', equals: 1408},
        {metric: 'finiteChecksum', equals: 991936}, {metric: 'timingCycles', equals: 128},
        {metric: 'historyCancellationCorrect', equals: true},
        {metric: 'historyEndpointsCorrect', equals: true}, {metric: 'historyReplays', equals: 2},
    ],
}))));
