/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Readable adapter. A six-capability external source over `useCarburetorValue`: unselected writes
// stay invisible (renders, texts), unmount releases the subscription. replace() iterates a listener
// snapshot because the hook re-subscribes during delivery; with the snapshot the writer's own reads
// filter exactly two notifications per round on every build, so these gates are contract controls.
export default [
    {
        id: 'readable/conditional-selection@32', improvement: 'control', scenario: 'readable/conditional-selection', args: [32],
        gates: [
            {metric: 'notifications', equals: 64}, {metric: 'renders', equals: 65},
            {metric: 'evaluations', equals: 65}, {metric: 'unselectedRenders', equals: 0},
            {metric: 'listenersLeft', equals: 0}, {metric: 'initialText', equals: 's0'},
            {metric: 'finalText', equals: 's32'},
        ],
    },
];
