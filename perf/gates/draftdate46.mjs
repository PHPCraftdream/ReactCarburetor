export default [
    {id: 'draftdate46/read-noop', improvement: 'R46-04', scenario: 'draftdate46/read-noop', args: [], gates: [
        {metric: 'entryCount', equals: 0}, {metric: 'ownedClones', equals: 0},
        {metric: 'clonedNodes', equals: 0}, {metric: 'dateClones', equals: 0},
        {metric: 'wakes', equals: 0}, {metric: 'correct', equals: true},
    ]},
    {
        id: 'draftdate46/change-undo-redo', improvement: 'R46-04',
        scenario: 'draftdate46/change-undo-redo', args: [], gates: [
            {metric: 'changedKind', equals: 'snapshot'}, {metric: 'changedSnapshots', min: 1},
            {metric: 'changedNodes', min: 1}, {metric: 'changedDateClones', min: 1},
            {metric: 'changedWakes', equals: 1}, {metric: 'undoCorrect', equals: true},
            {metric: 'redoCorrect', equals: true},
        ],
    },
    {id: 'draftdate46/date-heap@10k', improvement: 'R46-04', scenario: 'draftdate46/date-heap', args: [10000], gates: [
        {metric: 'datePerEntryKB', max: 50}, {metric: 'dateEntries', equals: 50},
        {metric: 'dateKind', equals: 'patches'}, {metric: 'dateSnapshots', equals: 0},
        {metric: 'dateClones', equals: 0}, {metric: 'dateEntryKinds', equals: true},
        {metric: 'dateWakes', equals: 0}, {metric: 'done', equals: true},
    ]},
];
