export default [
    {
        id: 'readset40/filed-paths@1000', improvement: 'R40-02', scenario: 'readset40/filed-paths',
        gates: [
            {metric: 'hookPaths', equals: 1}, {metric: 'classPaths', equals: 2},
            {metric: 'watchPaths', equals: 1}, {metric: 'computedPaths', equals: 2},
            {metric: 'activeCountPaths', equals: 1001},
            {metric: 'presenceMarkers', min: 1}, {metric: 'userMarkers', min: 1},
            {metric: 'wakeCorrect', equals: true},
            {metric: 'rowReplacement', equals: 1}, {metric: 'parentReplacement', equals: 3},
            {metric: 'siblingDeliveries', equals: 0}, {metric: 'inDeletion', equals: 1},
            {metric: 'userReplacement', equals: 1}, {metric: 'branchReplacement', equals: 1},
            {metric: 'branchMarkers', equals: 1},
        ],
    },
    {
        id: 'readset40/index-entries@5000', improvement: 'R40-02', scenario: 'readset40/index-entries',
        gates: [
            {metric: 'exact', equals: 5000}, {metric: 'branch', equals: 5001},
            {metric: 'completedPaths', equals: 1}, {metric: 'completedRows', equals: 5000},
            {metric: 'fullExact', equals: 10001}, {metric: 'fullPaths', equals: 3},
            {metric: 'completedIndexWork', over: 'fullIndexWork', max: 0.5},
            {metric: 'completedIndexWork', equals: 30000}, {metric: 'fullIndexWork', equals: 80000},
            {metric: 'completedExactVisits', equals: 10000}, {metric: 'completedBranchVisits', equals: 20000},
            {metric: 'fullExactVisits', equals: 30000}, {metric: 'fullBranchVisits', equals: 50000},
            {metric: 'completedMs', over: 'fullMs', max: 0.85},
            {metric: 'workEmpty', equals: true},
            {metric: 'empty', equals: true}, {metric: 'renderCorrect', equals: true},
        ],
    },
    {
        id: 'readset40/prune-work', improvement: 'R40-02', scenario: 'readset40/prune-work',
        gates: [
            {metric: 'presenceSets', equals: 0}, {metric: 'pairSets', equals: 0},
            {metric: 'hookSets', equals: 0}, {metric: 'fourSets', equals: 0}, {metric: 'classSets', equals: 0},
            {metric: 'activeSets', equals: 1}, {metric: 'hookPaths', equals: 1},
            {metric: 'classPaths', equals: 2}, {metric: 'activePaths', equals: 1001},
            {metric: 'correct', equals: true},
        ],
    },
    {
        id: 'readset40/bound-class-work', improvement: 'control', scenario: 'readset40/bound-class-work',
        gates: [
            {metric: 'initialReads', min: 10000}, {metric: 'maxReads', max: 4},
            {metric: 'initialSubscriptions', equals: 1}, {metric: 'refiles', equals: 0},
            {metric: 'filedChecks', equals: 84}, {metric: 'allChecks', max: 500},
            {metric: 'renders', equals: 21}, {metric: 'correct', equals: true},
        ],
    },
];
