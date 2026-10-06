/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Delivery. Delivered-callback counts are exact; cancellation must not cost more than the
// uncancelled control of the same run.
export default [
    {
        id: 'delivery/throttle-cancel', improvement: 'R11-06', scenario: 'delivery/throttle-cancel', args: [2000, 7],
        gates: [
            {metric: 'cancelledDelivered', equals: 2000}, {metric: 'controlDelivered', equals: 128000},
            {metric: 'cancelledMs', over: 'controlMs', max: 6},
        ],
    },
    {
        id: 'delivery/cache-views', improvement: 'R11-07', scenario: 'delivery/cache-views', args: [30000, 7],
        gates: [
            {metric: 'viewIdentities', equals: 1}, {metric: 'zeroChangeVisible', equals: true},
            {metric: 'nanPreserved', equals: true},
        ],
    },
    {
        id: 'delivery/store-delivery', improvement: 'R12-E01', scenario: 'delivery/store-delivery', args: [64, 500, 7],
        gates: [
            {metric: 'sharedDeliveries', equals: 2}, {metric: 'fanoutDeliveries', equals: 224000},
        ],
    },
]
