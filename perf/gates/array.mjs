/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Array engine. Written paths and woken readers are exact mechanism counters: index-level writes
// cost one path per shifted index (the pre-R32-03 field diff recorded ~30000 for a head splice),
// and only readers of shifted positions wake. Timings stay ungated (shared machine); the runner's
// --against mode compares every *Ms metric.
export default [
    {
        id: 'array/positional@10k', improvement: 'R32-03', scenario: 'array/positional', args: [10000, 0],
        gates: [
            {metric: 'spliceHeadPaths', equals: 10002}, {metric: 'spliceMidPaths', equals: 5002},
            {metric: 'shiftPaths', equals: 10002}, {metric: 'unshiftPaths', equals: 10003},
            {metric: 'reversePaths', equals: 10000}, {metric: 'sortPaths', equals: 10000},
            {metric: 'correct', equals: true}, {metric: 'subs', equals: false},
        ],
    },
    {
        id: 'array/positional@10k-subs', improvement: 'R32-03', scenario: 'array/positional', args: [10000, 1],
        gates: [
            {metric: 'spliceHeadPaths', equals: 10002}, {metric: 'spliceMidPaths', equals: 5002},
            {metric: 'shiftPaths', equals: 10002}, {metric: 'unshiftPaths', equals: 10003},
            {metric: 'reversePaths', equals: 10000}, {metric: 'sortPaths', equals: 10000},
            {metric: 'spliceHeadWoken', equals: 10000}, {metric: 'spliceMidWoken', equals: 5000},
            {metric: 'shiftWoken', equals: 10000}, {metric: 'unshiftWoken', equals: 10000},
            {metric: 'reverseWoken', equals: 10000}, {metric: 'sortWoken', equals: 10000},
            {metric: 'spliceHeadOtherWakes', equals: 0}, {metric: 'spliceMidOtherWakes', equals: 0},
            {metric: 'shiftOtherWakes', equals: 0}, {metric: 'unshiftOtherWakes', equals: 0},
            {metric: 'reverseOtherWakes', equals: 0}, {metric: 'sortOtherWakes', equals: 0},
            {metric: 'correct', equals: true}, {metric: 'subs', equals: true},
        ],
    },
    {
        id: 'array/memo-window@200k-plain', improvement: 'R32-04', scenario: 'array/memo-window',
        args: [200000, 0],
        gates: [
            {metric: 'driftKb', max: 2048}, {metric: 'windowHeld', equals: true},
            {metric: 'spotOk', equals: true}, {metric: 'viewSeesWindow', equals: true},
        ],
    },
    {
        id: 'array/memo-window@200k-view', improvement: 'R32-04', scenario: 'array/memo-window',
        args: [200000, 1],
        gates: [
            {metric: 'driftKb', max: 2048}, {metric: 'windowHeld', equals: true},
            {metric: 'spotOk', equals: true}, {metric: 'viewSeesWindow', equals: true},
        ],
    },
    // PG-HEAP
    // 523d6a04a5f5 object probe: plain child/branch/total 200000/0/200000;
    // view 399999/199999/599998. Candidate: 100/0/100 and 149/50/199; real controls pass.
    // Object-reading 100-key fixture; both childPaths and branchMarkers are counted separately.
    // Oldest-128 sample falls below half-live by 512 after 128/256 doubling; read size also
    // includes markers. <=2048 across handlers is conservative for THIS fixture, not a global cap.
    ...[0, 1].flatMap(view => [{
        id: `array/memo-window@200k-${view ? 'view' : 'plain'}-live`, improvement: 'R32-04',
        scenario: 'array/pg-heap/live-memos', args: [view],
        gates: [{metric: 'liveMemoEntries', max: 2048},
            {metric: 'liveChildPathEntries', max: 2048}, {metric: 'liveBranchMarkerEntries', max: 2048}],
    }, {
        id: `array/memo-window@200k-${view ? 'view' : 'plain'}-live-control`, improvement: 'control',
        scenario: 'array/pg-heap/live-memos', args: [view],
        gates: [{metric: 'positiveEntries', min: 62},
            {metric: 'positiveChildPathEntries', min: 31}, {metric: 'positiveBranchMarkerEntries', min: 31},
            {metric: 'positiveCorrect', equals: true}, {metric: 'idleEvents', equals: 0},
            {metric: 'childPathEvents', min: 200000},
            // Each audit reset uses a first-branch inline slot (no Map.set); allow those misses.
            {metric: 'branchMarkerEvents', min: view ? 190000 : 0},
            {metric: 'liveBranchMarkerEntries', min: view ? 1 : 0},
            {metric: 'liveChildPathEntries', min: 1},
            {metric: 'memoEvents', min: 200000}, {metric: 'liveMemoMaps', min: 1},
            {metric: 'windowHeld', equals: true}, {metric: 'spotOk', equals: true},
            {metric: 'viewSeesWindow', equals: true}, {metric: 'done', equals: true}],
    }]),
];
