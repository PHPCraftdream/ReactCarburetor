// Isolated liveness protection; existing gate entries remain untouched.
export default [
    {
        id: 'resource41/retention-live-cache', improvement: 'R41-04',
        scenario: 'resource41/retention', args: [],
        gates: [
            {metric: 'cases', equals: 10},
            {metric: 'collected', equals: 10},
            {metric: 'failedCases', equals: ''},
            {metric: 'stableChecks', equals: 10},
            {metric: 'strongAlive', equals: true},
            {metric: 'capturedAlive', equals: true},
            {metric: 'capturedReleased', equals: true},
            {metric: 'cachesAlive', equals: true},
        ],
    },
];
