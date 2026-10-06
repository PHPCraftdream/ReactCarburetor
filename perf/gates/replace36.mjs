/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
export default [
    {
        id: 'replace36/public-replacements@10k', improvement: 'R36-04', scenario: 'replace36/public-replacements', args: [10000, 9],
        gates: [
            {metric: 'setDataKind', equals: 'patches'}, {metric: 'restoreKind', equals: 'patches'}, {metric: 'fromJSONKind', equals: 'patches'},
            {metric: 'setDataValid', equals: true}, {metric: 'restoreValid', equals: true}, {metric: 'fromJSONValid', equals: true},
        ],
    },
    {
        id: 'replace36/relative-diff@10k', improvement: 'R36-05', scenario: 'replace36/relative-diff', args: [10000, 2010],
        gates: [
            {metric: 'paths', equals: 2010}, {metric: 'changed', equals: 2010},
            {metric: 'precise', equals: true}, {metric: 'noRoot', equals: true}, {metric: 'unrelatedAsleep', equals: true},
        ],
    },
];
