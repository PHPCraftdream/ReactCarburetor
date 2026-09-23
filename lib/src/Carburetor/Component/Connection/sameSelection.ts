import {isPlainObject} from "./isPlainObject";
import {ownEnumerableKeys} from "./ownEnumerableKeys";

/**
 * Whether a fresh selection has the same content as the snapshot already handed out, so "same"
 * here means the handed-out snapshot may keep its identity — and the gated child keeps its
 * bail-out.
 *
 * A plain object compares its own enumerable string and symbol keys — the exact set a shallow
 * spread copies — for membership plus `Object.is` values, and an array compares its length and
 * elements with `Object.is`, the exact set `Array.from` copies. The detached previous snapshot
 * is compared against the raw fresh selection: a shallow copy shares every member with its
 * source, so identity differences introduced by detaching say nothing about content.
 *
 * @param snapshot - the snapshot already handed out, possibly detached from its source
 * @param next - the fresh selection to compare it against
 */
export const sameSelection = (snapshot: unknown, next: unknown): boolean => {
    if (Object.is(snapshot, next)) {
        return true;
    }

    const snapshotIsArray = Array.isArray(snapshot);
    const nextIsArray = Array.isArray(next);

    if (snapshotIsArray || nextIsArray) {
        if (!snapshotIsArray || !nextIsArray) {
            return false;
        }

        // Deliberate asymmetry with the plain-object branch below: `Array.from` copies indices
        // and nothing else — no extra own properties, no symbol keys — so element-wise Object.is
        // already covers the whole copied set of an array.

        // Bindings narrowed ahead of the callback: a `.every` body runs outside the guards'
        // narrowing reach.
        const previousMembers = snapshot as unknown[];
        const freshMembers = next as unknown[];

        return previousMembers.length === freshMembers.length &&
            previousMembers.every((member: unknown, index: number): boolean =>
                Object.is(member, freshMembers[index]));
    }

    if (!isPlainObject(snapshot) || !isPlainObject(next)) {
        return false;
    }

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
        Object.is(previousMembers[key], freshMembers[key]));
};
