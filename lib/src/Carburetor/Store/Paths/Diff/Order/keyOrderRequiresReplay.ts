import {isOrderedStringKey} from './isOrderedStringKey';

/** Can native deletion followed by appending new keys produce `next`'s string-key order? */
const canAppend = (previous: readonly string[], next: readonly string[]): boolean => {
    const existing = new Set(previous);
    const retained = new Set(next);
    let position = 0;

    for (const key of previous) {
        if (isOrderedStringKey(key) && retained.has(key)) {
            while (position < next.length && !isOrderedStringKey(next[position])) position++;
            if (next[position++] !== key) return false;
        }
    }
    for (const key of next) {
        if (isOrderedStringKey(key) && !existing.has(key)) {
            while (position < next.length && !isOrderedStringKey(next[position])) position++;
            if (next[position++] !== key) return false;
        }
    }
    return true;
};

/** Both directions must preserve order: an inverse patch re-adds deleted keys at the end.
 *
 * @param previous - own keys before replacement.
 * @param next - own keys after replacement.
 */
export const keyOrderRequiresReplay = (previous: readonly string[], next: readonly string[]): boolean =>
    !canAppend(previous, next) || !canAppend(next, previous);
