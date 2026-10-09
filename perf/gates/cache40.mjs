export default ['success', 'failure'].map(mode => ({
    id: `cache40/settle-${mode}`,
    improvement: 'R40-05',
    scenario: 'cache40/settle', args: [mode],
    gates: [
        {metric: 'traps', equals: mode === 'success' ? 9 : 6},
        {metric: 'traps', over: 'controlTraps', max: 0.5},
        {metric: 'gets', equals: 2},
        {metric: 'sets', equals: mode === 'success' ? 7 : 4},
        {metric: 'has', equals: 0}, {metric: 'deletes', equals: 0}, {metric: 'ownKeys', equals: 0},
        {metric: 'controlTraps', equals: mode === 'success' ? 21 : 12},
        {metric: 'controlGets', equals: mode === 'success' ? 14 : 8},
        {metric: 'controlSets', equals: mode === 'success' ? 7 : 4},
        {metric: 'controlHas', equals: 0},
        {metric: 'controlDeletes', equals: 0}, {metric: 'controlOwnKeys', equals: 0},
        {metric: 'correct', equals: true},
    ],
}));
