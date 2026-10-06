/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
export default [
    {
        id: 'drift36/log-reset@10k', improvement: 'R36-03', scenario: 'drift36/log-reset', args: [],
        gates: [
            {metric: 'recomputes', equals: 0}, {metric: 'writeLogConsultations', equals: 0},
            {metric: 'result', equals: 5000},
        ],
    },
    {
        id: 'drift36/related-writes@10k', improvement: 'R36-03', scenario: 'drift36/related-writes',
        args: [10000, 21],
        gates: [
            {metric: 'writeLogConsultations', equals: 0},
            {metric: 'controlConsultations', min: 1}, {metric: 'unfiledAnswer', equals: true},
            {metric: 'wakes', equals: 21}, {metric: 'result', equals: 9979},
        ],
    },
];
