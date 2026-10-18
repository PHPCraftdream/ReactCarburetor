// PERF round 45: completing a deep read set prunes through per-path owner slices, so the
// commit no longer builds a prefix Set over every ancestor of every recorded path.
export default [
    {
        id: 'readset41/prune-owners@4k', improvement: 'R45-01',
        scenario: 'readset41/prune-owners', args: [1000, 8],
        gates: [
            {metric: 'depthSlices', max: 6100},
            {metric: 'siblingStartsWith', max: 100000},
            {metric: 'siblingCorrect', equals: true},
            {metric: 'depthSets', equals: 1},
            {metric: 'smallSets', equals: 0},
            {metric: 'smallSlices', equals: 1},
            {metric: 'paths', equals: 4002},
            {metric: 'wideCorrect', equals: true},
            {metric: 'correct', equals: true},
        ],
    },
];
