/* oxlint-disable carburetor/max-line-length, carburetor/require-tsdoc */
// Invalid GC controls mean inconclusive, never evidence of library retention.
// Timing metrics are report-only for baseline/fix comparison; old gates are untouched.
export default [
    {id: 'aliases43/retired-root', improvement: 'R43-S03', scenario: 'aliases43/retired-root', args: [], gates: [
        {metric: 'cases', equals: 3}, {metric: 'controlsValid', equals: true},
        {metric: 'inconclusive', equals: false}, {metric: 'cachedCollected', equals: 3},
        {metric: 'overwriteCollected', equals: 3}, {metric: 'ownersAlive', equals: true},
    ]},
    {id: 'aliases43/precision', improvement: 'R43-S03', scenario: 'aliases43/precision', args: [], gates: [
        {metric: 'getters', equals: 0}, {metric: 'aliasWakes', equals: 4},
        {metric: 'unrelatedWakes', equals: 0}, {metric: 'backlinkWakes', equals: 1},
        {metric: 'crossRoot', equals: true}, {metric: 'generationRefresh', equals: true},
        {metric: 'hiddenOwnData', equals: true}, {metric: 'precision', equals: true},
    ]},
    ...[32, 512].map(width => ({id: `aliases43/timing@${width}`, improvement: 'R43-S03',
        scenario: 'aliases43/timing', args: [width], gates: [
            {metric: 'samples', equals: 9}, {metric: 'batch', equals: 4096},
            {metric: 'iterationBatch', equals: 32}, {metric: 'checksumsCorrect', equals: true},
        ]})),
];
