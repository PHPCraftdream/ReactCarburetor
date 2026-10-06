/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Resource. The mechanism gate is the serialization counter: resolve() of a warm primitive must
// not re-derive its key (the pre-R30-08 build stringifies once per resolve, so the gate fails
// there), and the golden-string gates pin the key and path bytes a key must keep.
export default [
    {
        id: 'resource/resolve@4k', improvement: 'R30-08', scenario: 'resource/resolve', args: [4000, 9],
        gates: [
            {metric: 'stringifyCalls', equals: 0}, {metric: 'coldStringifies', equals: 1},
            {metric: 'keysOk', equals: true},
            {metric: 'goldenOk', equals: true},
            {metric: 'goldenSeen', equals: '0|entries.0|""|entries.""|"a~1b"|entries."a~01b"|"x~0y"|entries."x~00y"|true|entries.true|null|entries.null'},
        ],
    },
];
