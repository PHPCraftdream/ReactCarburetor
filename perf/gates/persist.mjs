/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Partitioned persist and the throttleMs write-rate bound: mechanism counters only, no
// timing ceilings. The throttle scenario stubs the clock persist reads and advances the
// window by hand, so the counters are the same whatever the process pauses do. The
// pre-change build fails on the counters (whole-store key rewritten, no branch keys, one
// write per tick), not on a crash: unknown options are ignored there.
export default [
    {
        id: 'store/r33-persist-partition@10k', improvement: 'R2026-10-16', scenario: 'store/r33-persist-partition',
        args: [10000, 50],
        gates: [
            {metric: 'wholeKeyWrites', equals: 0},
            {metric: 'sealBranchKeys', equals: 10},
            {metric: 'dirtyFlushKeys', equals: 1},
            {metric: 'contentOk', equals: true},
        ],
    },
    {
        id: 'store/r33-persist-throttle@10k', improvement: 'R2026-10-16', scenario: 'store/r33-persist-throttle',
        args: [10000, 5],
        gates: [
            {metric: 'burstWrites', equals: 1}, {metric: 'writesBeforeDispose', equals: 2},
            {metric: 'setItemCalls', equals: 2}, {metric: 'contentOk', equals: true},
        ],
    },
];
