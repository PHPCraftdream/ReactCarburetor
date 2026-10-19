import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {sameKind} from '@/Carburetor/Store/Paths/Diff/Kinds/sameKind';

const hasOwn = Object.prototype.hasOwnProperty;

/**
 * Counts the differing leaves restore would install: own-key or hole changes count one, equal
 * values none, and only same-kind container pairs are descended.
 *
 * @param previous - the branch's current raw value.
 * @param next - the corresponding value being installed; read only.
 */
export const countChanges = (previous: unknown, next: unknown): number => {
    if (Object.is(previous, next)) return 0;
    if (!isTrackable(previous) || !isTrackable(next) || !sameKind(previous, next)) return 1;
    let count = 0;
    if (Array.isArray(previous)) {
        const oldArray = previous as unknown[];
        const newArray = next as unknown[];
        for (let index = 0; index < Math.max(oldArray.length, newArray.length); index++) {
            const oldOwn = hasOwn.call(oldArray, index);
            const newOwn = hasOwn.call(newArray, index);
            if (oldOwn === newOwn && Object.is(oldArray[index], newArray[index])) continue;
            count += oldOwn && newOwn ? countChanges(oldArray[index], newArray[index]) : 1;
        }
        return count;
    }
    const keys = new Set<string>(Object.keys(previous));
    const nextKeys = Object.keys(next);
    for (const key of nextKeys) keys.add(key);
    for (const key of keys) {
        if (!hasOwn.call(previous, key) || !hasOwn.call(next, key)) { count++; continue; }
        count += countChanges((previous as Record<string, unknown>)[key], (next as Record<string, unknown>)[key]);
    }
    return count;
};
