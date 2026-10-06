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
];
