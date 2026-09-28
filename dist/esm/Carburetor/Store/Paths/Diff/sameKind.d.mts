/**
 * Whether two trackable values are the same shape of container — both arrays or both plain
 * objects.
 *
 * `diffPaths` and `applyDiff` only walk into a pair that agrees; the other case is a kind
 * change, reported as a whole-value replacement.
 *
 * @param a - one side of the comparison.
 * @param b - the other side.
 */
export declare const sameKind: (a: object, b: object) => boolean;
