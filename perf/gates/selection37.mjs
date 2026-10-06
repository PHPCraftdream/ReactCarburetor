/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
export default [
    {
        id: 'selection37/alias-topology@2', improvement: 'R37-01', scenario: 'selection37/alias-topology', args: [2],
        gates: [
            {metric: 'aliasBothEdits', equals: true},
            {metric: 'linkedValues', equals: '2,3'},
            {metric: 'introducedAlias', equals: true},
            {metric: 'plainValues', equals: '2,3'},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'selection37/patch-budget@4k', improvement: 'R37-04', scenario: 'selection37/patch-budget', args: [4000],
        gates: [
            // Both sides of the old absolute cliff stay bounded by the batch, not by the list.
            {metric: 'paths64', max: 400}, {metric: 'paths65', max: 400}, {metric: 'paths128', max: 800},
            // The control proves the counter sees a full walk at this size.
            {metric: 'controlPaths', min: 4000},
            {metric: 'delivered', equals: '65|128|7'},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'selection37/bounded-reads@64', improvement: 'R37-03', scenario: 'selection37/bounded-reads', args: [1],
        gates: [
            // The filed set is constant in the cycle count: the replaced subtree resets its ownership.
            {metric: 'paths16', max: 50}, {metric: 'paths64', max: 50},
            // Positive control: the counter still sees a genuinely growing payload.
            {metric: 'controlPaths', min: 25},
            {metric: 'delivered', equals: '32|128|32'},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'selection37/primitive-wake@1', improvement: 'R37-05', scenario: 'selection37/primitive-wake', args: [1],
        gates: [
            {metric: 'weakmapConstructors', equals: 0}, {metric: 'weaksetConstructors', equals: 0},
            // Positive control: the counter still sees the object path's ledgers.
            {metric: 'objectControlWeakmaps', min: 1}, {metric: 'objectControlWeaksets', min: 1},
            {metric: 'delivered', equals: '0|1|5'},
            {metric: 'done', equals: true},
        ],
    },
];
