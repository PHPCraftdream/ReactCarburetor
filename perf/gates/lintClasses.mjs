/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Throughput scaling of the functional-class rules (CLS-9): the CSS index, the eight stylesheet
// rules and the markup rule over a generated project. Exact finding counts prove every part ran;
// the 8k/2k time ratio (linear work is about 4x, the budget of 12 leaves a 3x noise margin) is the
// guard against a quadratic index or lookup. Requires the release binary, like lintBinary.mjs.
export default [
    {
        id: 'lint-binary/classes@2k', improvement: 'CLS-9', scenario: 'lint-binary/classes',
        args: [2000], requires: [{path: 'native/target/release'}],
        gates: [
            {metric: 'markup', equals: 1000}, {metric: 'functions', equals: 500}, {metric: 'done', equals: true},
        ],
    },
    {
        id: 'lint-binary/classes@8k', improvement: 'CLS-9', scenario: 'lint-binary/classes',
        args: [8000], requires: [{path: 'native/target/release'}],
        gates: [
            {metric: 'markup', equals: 4000}, {metric: 'functions', equals: 2000}, {metric: 'done', equals: true},
            {metric: 'lintMs', scale: {from: 'lint-binary/classes@2k'}, max: 12},
        ],
    },
];
