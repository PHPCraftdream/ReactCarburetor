/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Throughput scaling of the lint binary (TEST-19): the 8k/2k time ratio is the guard. Linear
// work costs about 4x, so the budget of 12 leaves a 3x margin over the noise; a superlinear
// capture scan or a quadratic pass shows up far above it. Requires the release binary, so a
// checkout without one reports skip, like every other machine-dependent gate. Registered in the
// freeze contract by the orchestrator in the same commit.
export default [
    {
        id: 'lint-binary/scaling@2k', improvement: 'R2026-10-16', scenario: 'lint-binary/scaling',
        args: [2000], requires: [{path: 'native/target/release'}],
        gates: [
            {metric: 'found', equals: 2000}, {metric: 'done', equals: true},
        ],
    },
    {
        id: 'lint-binary/scaling@8k', improvement: 'R2026-10-16', scenario: 'lint-binary/scaling',
        args: [8000], requires: [{path: 'native/target/release'}],
        gates: [
            {metric: 'found', equals: 8000}, {metric: 'done', equals: true},
            {metric: 'lintMs', scale: {from: 'lint-binary/scaling@2k'}, max: 12},
        ],
    },
];
