/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Subscribers. R30-09 replaced the per-path ancestors array — allocated per filed path and walked
// with Array.prototype.forEach — with an in-place backward scan. ancestorArrayWalks counts exactly
// that mechanism (one per path on the pre-R30 build, zero after), probeSelfCount proves the probe
// still counts, and the wake checks keep a no-op add/remove from looking fast; the @4k scale
// gates watch filing cost staying linear in subscriber count.
export default [
    {
        id: 'subscribers/filing@1k', improvement: 'R30-09', scenario: 'subscribers/filing', args: [1000, 5],
        gates: [
            {metric: 'ancestorArrayWalks', equals: 0},
            {metric: 'probeSelfCount', equals: 1},
            {metric: 'wakesExact', equals: true},
            {metric: 'wakesAncestor', equals: true},
            {metric: 'filedOk', equals: true},
            {metric: 'leftovers', equals: false},
        ],
    },
    {
        id: 'subscribers/filing@4k', improvement: 'R30-09', scenario: 'subscribers/filing', args: [4000, 5],
        gates: [
            {metric: 'ancestorArrayWalks', equals: 0},
            {metric: 'probeSelfCount', equals: 1},
            {metric: 'wakesExact', equals: true},
            {metric: 'wakesAncestor', equals: true},
            {metric: 'filedOk', equals: true},
            {metric: 'leftovers', equals: false},
            {metric: 'fileMs', scale: {from: 'subscribers/filing@1k'}, max: 8},
            {metric: 'unfileMs', scale: {from: 'subscribers/filing@1k'}, max: 8},
        ],
    },
];
