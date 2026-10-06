/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// History. R31-04: a canceled scalar batch proves cancellation without a full capture; both sizes
// fall on pre-R31 builds (capture 1, 3 x rows row visits). constructionCaptures is the control that
// keeps the captureHistory hook honest. Ordinary undo/redo stays intact.
export default [
    {
        id: 'history31/scalar-cancellation@32', improvement: 'R31-04', scenario: 'history31/scalar-cancellation', args: [32],
        gates: [
            {metric: 'constructionCaptures', equals: 1}, {metric: 'canceledCaptures', equals: 0}, {metric: 'canceledRowVisits', equals: 0},
            {metric: 'canUndoAfterCancel', equals: false}, {metric: 'ordinaryCaptures', equals: 0},
            {metric: 'undone', equals: true}, {metric: 'valueAfterUndo', equals: 0},
            {metric: 'redone', equals: true}, {metric: 'valueAfterRedo', equals: 1},
        ],
    },
    {
        id: 'history31/scalar-cancellation@512', improvement: 'R31-04', scenario: 'history31/scalar-cancellation', args: [512],
        gates: [
            {metric: 'constructionCaptures', equals: 1}, {metric: 'canceledCaptures', equals: 0}, {metric: 'canceledRowVisits', equals: 0},
            {metric: 'canUndoAfterCancel', equals: false}, {metric: 'ordinaryCaptures', equals: 0},
            {metric: 'undone', equals: true}, {metric: 'valueAfterUndo', equals: 0},
            {metric: 'redone', equals: true}, {metric: 'valueAfterRedo', equals: 1},
        ],
    },
];
