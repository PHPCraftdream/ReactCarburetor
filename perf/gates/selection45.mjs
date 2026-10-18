// PERF round 45: the full selection reconcile resolves one raw target per member, so a wake
// over a fresh projection halves its RAW_TARGET hatch probes.
export default [
    {
        id: 'selection45/reconcile-probes@1k', improvement: 'R45-04',
        scenario: 'selection45/reconcile-probes', args: [1000, 6],
        gates: [
            {metric: 'probesPerWake', max: 3000},
            {metric: 'initialRenders', equals: 1},
            {metric: 'wakeRenders', equals: 6},
            {metric: 'finalChecksum', equals: 499500},
            {metric: 'lastTitleSeen', equals: 'w5'},
            {metric: 'done', equals: true},
        ],
    },
];
