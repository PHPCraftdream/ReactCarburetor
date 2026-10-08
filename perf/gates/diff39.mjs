/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
export default [
    ...[1000, 10000].flatMap(count => ['middle', 'first'].map(where => {
        const paths = count - (where === 'first' ? 0 : count / 2) + 2;
        const wakes = Array.from({length: 200}, (_, i) => i * 37 % count).filter(i => where === 'first' || i >= count / 2).length;
        return {
            id: `diff39/filter-assign-${where}@${count}`, area: 'diff39', improvement: 'R39-05',
            scenario: 'diff39/filter-assign', args: [count, where],
            gates: [
                {metric: 'paths', equals: paths}, {metric: 'wokenOf200', equals: wakes},
                {metric: 'splicePaths', equals: paths}, {metric: 'spliceWokenOf200', equals: wakes},
                {metric: 'filterOnlyPaths', equals: 0}, {metric: 'filterOnlyWokenOf200', equals: 0},
                {metric: 'filterOnlyUnchanged', equals: true},
                {metric: 'correctRows', equals: count - 1}, {metric: 'filterOnlyCorrectRows', equals: count},
                {metric: 'discardLength', equals: count - 1},
                {metric: 'exactPaths', equals: true}, {metric: 'valid', equals: true},
                ...(count === 10000 ? [{metric: 'paths', scale: {from: `diff39/filter-assign-${where}@1000`}, max: 10}] : []),
            ],
        };
    })),
    {
        id: 'diff39/map-replace-one@10k', area: 'diff39', improvement: 'control', scenario: 'diff39/map-replace-one', args: [],
        gates: [{metric: 'paths', equals: 1}, {metric: 'wokenOf200', equals: 1},
            {metric: 'exactLeaf', equals: true}, {metric: 'valid', equals: true}],
    },
    {
        id: 'diff39/genuine-leaves@5k', area: 'diff39', improvement: 'control', scenario: 'diff39/genuine-leaves', args: [],
        gates: [{metric: 'partialPaths', equals: 2010}, {metric: 'collapsedPaths', equals: 1},
            {metric: 'shiftedNewPaths', equals: 1}, {metric: 'partialLeaf', equals: true},
            {metric: 'collapsed', equals: true}, {metric: 'shiftedNewCollapsed', equals: true}, {metric: 'valid', equals: true}],
    },
    {
        // Outside the contract: one object under two branches. Values must still restore exactly (identity is not gated).
        id: 'diff39/external-alias-history@2', area: 'diff39', improvement: 'R39-05',
        scenario: 'diff39/external-alias-history', args: [],
        gates: [
            {metric: 'swapSelected', equals: 'a'}, {metric: 'undoSelected', equals: 'a'}, {metric: 'redoSelected', equals: 'a'},
            {metric: 'undoRows', equals: 'a,b'}, {metric: 'redoRows', equals: 'b,a'}, {metric: 'receiptsOk', equals: true},
            {metric: 'exceptionCount', equals: 0}, {metric: 'diagnosticCount', equals: 0}, {metric: 'valid', equals: true},
        ],
    },
];
