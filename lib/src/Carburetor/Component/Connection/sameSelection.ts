import {isPlainObject} from "./isPlainObject";
import {ownEnumerableKeys} from "./ownEnumerableKeys";

/**
 * Own-enumerable-key equality shared by the array and plain-object branches of `sameValue`:
 * same key set (strings and symbols alike — `detachSelection`'s exact copied set, arrays
 * included) and every value recursively `sameValue`.
 */
const sameKeyedContent = (snapshot: object, next: object, seen: WeakMap<object, object>): boolean => {
    const previousKeys = ownEnumerableKeys(snapshot);
    const freshKeys = ownEnumerableKeys(next);

    if (previousKeys.length !== freshKeys.length) {
        return false;
    }

    // Bindings narrowed ahead of the callback: a `.every` body runs outside the guards'
    // narrowing reach.
    const previousMembers = snapshot as Record<string | symbol, unknown>;
    const freshMembers = next as Record<string | symbol, unknown>;

    // Equal cardinality plus every previous key present on the fresh object leaves the two key
    // sets no room to differ, so a key swapped for another one — `{a: undefined}` becoming
    // `{b: undefined}`, say — is a content change even though the counts match.
    return previousKeys.every((key: string | symbol): boolean =>
        Object.prototype.hasOwnProperty.call(freshMembers, key) &&
        sameValue(previousMembers[key], freshMembers[key], seen));
};

/**
 * Deep, cycle-safe structural equality between a value already handed out (possibly a detached
 * copy) and a freshly read one (possibly still live).
 *
 * A detached copy never shares a reference with the live data it was built from — a fresh
 * container every call, and a fresh proxy for every nested live-view read — so a comparison
 * that stopped at `Object.is` on a nested plain object or array would report a change on every
 * call regardless of content, even when nothing the child can see actually changed. Recursing by
 * own enumerable key — the exact set `detachSelection` copies, arrays' custom properties and
 * true length included — is what makes "same content" and "same handed-out identity" agree at
 * every depth, not only the top one.
 *
 * A pair already on the current comparison path is treated as equal: the only way that
 * situation arises is a cycle in the compared data (mirrors `detachSelection`'s own cycle
 * guard), not a real mismatch this recursion could otherwise resolve.
 *
 * @param seen - previous-side object -> the fresh-side object it is being compared against on
 * this call's path, so a cycle reuses that verdict instead of recursing forever
 */
const sameValue = (a: unknown, b: unknown, seen: WeakMap<object, object>): boolean => {
    if (Object.is(a, b)) {
        return true;
    }

    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return false;
    }

    if (seen.get(a) === b) {
        return true;
    }

    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return false;
        }

        seen.set(a, b);

        return sameKeyedContent(a, b, seen);
    }

    if (!isPlainObject(a) || !isPlainObject(b)) {
        return false;
    }

    seen.set(a, b);

    return sameKeyedContent(a, b, seen);
};

/**
 * Whether a fresh selection has the same content as the snapshot already handed out, so "same"
 * here means the handed-out snapshot may keep its identity — and the gated child keeps its
 * bail-out.
 *
 * @param snapshot - the snapshot already handed out, possibly detached from its source
 * @param next - the fresh selection to compare it against
 */
export const sameSelection = (snapshot: unknown, next: unknown): boolean =>
    sameValue(snapshot, next, new WeakMap<object, object>());
