/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Tooling contracts. The DevTools bridge publishes every write and carries a prototype-named
// store as an own state key with its snapshot (R9-02).
export default [
    {
        id: 'contracts/devtools@500', improvement: 'R9-02', scenario: 'contracts/devtools', args: [500],
        gates: [
            {metric: 'sent', equals: 500}, {metric: 'initHasProto', equals: 1},
            {metric: 'stateHasProto', equals: 1}, {metric: 'stateHasCounter', equals: 1},
            {metric: 'lastValue', equals: 500}, {metric: 'protoIsSnapshot', equals: 1},
        ],
    },
];
