/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R39-04 release: once the last selection consumer is gone a store behaves as if it never had one.
export default ['watch', 'hook', 'class'].map(route => ({
    id: `trackrelease39/release-${route}@1000`, improvement: 'R39-04',
    scenario: 'trackrelease39/release', args: [route],
    gates: [
        {metric: 'maps', max: 3}, {metric: 'sets', max: 2000}, {metric: 'sets', min: 1000},
        {metric: 'aliveReads', max: 4}, {metric: 'remountReads', max: 4}, {metric: 'done', equals: true},
    ],
}));
