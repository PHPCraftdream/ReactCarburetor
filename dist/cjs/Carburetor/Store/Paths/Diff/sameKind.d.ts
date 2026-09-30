/**
 * Whether two trackable values are the same kind of container — both arrays or both plain
 * objects, with the same supported prototype (`Array.prototype`/`Object.prototype` or null).
 *
 * `diffPaths` and `applyDiff` only walk into a pair that agrees; the other case is a kind
 * change, reported as a whole-value replacement.
 *
 * @param a - one side of the comparison.
 * @param b - the other side.
 */
export declare const sameKind: (a: object, b: object) => boolean;
