import {isTrackable} from '../isTrackable';
import {isOrdinaryDate} from '../Proxy/Definitions/isOrdinaryDate';
import {nativeAliasIndex} from './NativeAliasIndex';

/** Refreshes ownership after a value assignment on a draft target.
 *
 * @param root - optional raw draft root
 * @param target - assigned property owner
 * @param key - assigned property key
 * @param previous - value before assignment
 * @param next - assigned value
 * @param path - assigned property path
 */
export const recordNativeAssignment = (
    root: object | undefined, target: object, key: string,
    previous: unknown, next: unknown, path: string,
): void => {
    if (root === undefined || previous === next) return;
    if (next !== null && typeof next === 'object' && !isTrackable(next) && !isOrdinaryDate(next)) {
        nativeAliasIndex.invalidate(root);
        return;
    }
    if (isTrackable(previous) || isTrackable(next)) {
        nativeAliasIndex.noteChange(root, target, key, previous, next, path);
    }
};
