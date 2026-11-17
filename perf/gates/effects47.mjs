// PERF round 47: a useStoreEffect with unchanged store, selector and effect allocates nothing on a
// re-render; it never reaches useEffect again, so the watch and the effect run once.
export default [
    {
        id: 'effects47/store-effect-rerender@200', improvement: 'R47-01',
        scenario: 'effects47/store-effect-rerender', args: [200],
        gates: [
            {metric: 'useEffectCalls', equals: 1},
            {metric: 'effectRuns', equals: 1},
            {metric: 'watches', equals: 1},
            {metric: 'followed', equals: true},
            {metric: 'done', equals: true},
        ],
    },
];
