export default ['success', 'failure'].map(mode => ({
    id: `cache40/settle-${mode}`,
    improvement: 'R40-05',
    scenario: 'cache40/settle', args: [mode],
    gates: [
        {metric: 'traps', equals: mode === 'success' ? 12 : 9},
        {metric: 'traps', over: 'controlTraps', max: 0.5},
        {metric: 'gets', equals: 3},
        {metric: 'sets', equals: mode === 'success' ? 9 : 6},
        {metric: 'has', equals: 0}, {metric: 'deletes', equals: 0}, {metric: 'ownKeys', equals: 0},
        {metric: 'controlTraps', equals: mode === 'success' ? 27 : 18},
        {metric: 'controlGets', equals: mode === 'success' ? 18 : 12},
        {metric: 'controlSets', equals: mode === 'success' ? 9 : 6},
        {metric: 'controlHas', equals: 0},
        {metric: 'controlDeletes', equals: 0}, {metric: 'controlOwnKeys', equals: 0},
        {metric: 'correct', equals: true},
    ],
}));
