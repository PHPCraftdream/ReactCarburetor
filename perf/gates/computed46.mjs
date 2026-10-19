export default [1000, 10000].map(F => ({
    id: `computed46/foreign-write-probes@${F}`,
    improvement: 'R46-11',
    scenario: 'computed46/foreign-write-probes', args: [F],
    gates: [
        {metric: 'probesAfterUnrelatedSameStore', equals: F},
        {metric: 'probesAfterForeignWrite', equals: 0},
        {metric: 'recomputes', equals: 0},
        {metric: 'valueAfterRelated', equals: F * (F - 1) / 2 + 1},
        {metric: 'correctness', equals: true},
        {metric: 'done', equals: true},
    ],
}));
