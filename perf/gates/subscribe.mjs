/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Subscriptions. Wake, growth, retention and heap facts are exact counters or same-run ratios;
// the 4k/1k one-write scale guards the index against a per-subscriber scan regression.
export default [
    {
        id: 'subscribe/reads-copy@1k', improvement: 'R6-04', scenario: 'subscribe/reads-copy', args: [1000, 9],
        gates: [
            {metric: 'callerMutationWakes', equals: 0}, {metric: 'grownReadsWake', equals: 1},
            {metric: 'frozenReadsWake', equals: 1}, {metric: 'transferWakes', equals: 1},
        ],
    },
    {
        id: 'subscribe/reads-copy@4k', improvement: 'R6-04', scenario: 'subscribe/reads-copy', args: [4000, 9],
        gates: [
            {metric: 'callerMutationWakes', equals: 0}, {metric: 'grownReadsWake', equals: 1},
            {metric: 'transferWakes', equals: 1},
            {metric: 'transferBytes', over: 'publicBytes', max: 0.95},
        ],
    },
    {
        id: 'subscribe/subscriber-ids@1k', improvement: 'R7-04', scenario: 'subscribe/subscriber-ids', args: [1000, 9],
        gates: [
            {metric: 'protoDelivered', equals: 1}, {metric: 'protoWakesAfterUnsubscribe', equals: 0},
            {metric: 'ctorDelivered', equals: 1}, {metric: 'ctorWakesAfterUnsubscribe', equals: 0},
            {metric: 'protoIdFiled', equals: true}, {metric: 'protoSlotIsolated', equals: true},
            {metric: 'protoIdGone', equals: true}, {metric: 'protoSlotClean', equals: true},
        ],
    },
    {
        id: 'subscribe/match-precision@100', improvement: 'R16-02', scenario: 'subscribe/match-precision', args: [100, 9],
        gates: [
            {metric: 'replaceWakes', equals: 1}, {metric: 'setDataWakes', equals: 1},
            {metric: 'restoreWakes', equals: 1}, {metric: 'unmatchedWakes', equals: 0},
            {metric: 'publications', equals: 3},
            {metric: 'indexOneWakes', equals: 1}, {metric: 'indexParentWakes', equals: 1},
            {metric: 'droppedSiblingWakes', equals: 0}, {metric: 'keptSiblingWakes', equals: 1},
            {metric: 'multiWakes', equals: 50},
        ],
    },
    {
        id: 'subscribe/match-precision@1k', improvement: 'R16-02', scenario: 'subscribe/match-precision', args: [1000, 9],
        gates: [
            {metric: 'replaceWakes', equals: 1}, {metric: 'setDataWakes', equals: 1},
            {metric: 'restoreWakes', equals: 1}, {metric: 'unmatchedWakes', equals: 0},
            {metric: 'publications', equals: 3},
            {metric: 'indexOneWakes', equals: 1}, {metric: 'indexParentWakes', equals: 1},
            {metric: 'droppedSiblingWakes', equals: 0}, {metric: 'keptSiblingWakes', equals: 1},
            {metric: 'multiWakes', equals: 500},
            {metric: 'heapBytesPerSubscriber', max: 1500},
        ],
    },
    {
        id: 'subscribe/match-precision@4k', improvement: 'R16-02', scenario: 'subscribe/match-precision', args: [4000, 9],
        gates: [
            {metric: 'replaceWakes', equals: 1}, {metric: 'setDataWakes', equals: 1},
            {metric: 'restoreWakes', equals: 1}, {metric: 'unmatchedWakes', equals: 0},
            {metric: 'publications', equals: 3},
            {metric: 'indexOneWakes', equals: 1}, {metric: 'indexParentWakes', equals: 1},
            {metric: 'droppedSiblingWakes', equals: 0}, {metric: 'keptSiblingWakes', equals: 1},
            {metric: 'multiWakes', equals: 500},
            {metric: 'heapBytesPerSubscriber', max: 1500},
            {metric: 'oneWriteMs', scale: {from: 'subscribe/match-precision@1k'}, max: 3},
        ],
    },
]
