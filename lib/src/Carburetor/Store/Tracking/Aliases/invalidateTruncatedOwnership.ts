import {nativeAliasIndex} from './NativeAliasIndex';

/** Discard ownership only when a native length write effectively removes a suffix.
 *
 * @param root - optional raw draft root whose ownership is cached.
 * @param previousLength - array length before the native write.
 * @param nextLength - effective length, including a refused partial truncation.
 */
export const invalidateTruncatedOwnership = (
    root: object | undefined, previousLength: number, nextLength: number
): void => {
    if (root !== undefined && nextLength < previousLength) nativeAliasIndex.invalidate(root);
};
