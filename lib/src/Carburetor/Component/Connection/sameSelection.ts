import {isPlainObject} from "./isPlainObject";

/**
 * Whether the value is an object `detachSelection` passes through untouched — a Map, Set, Date,
 * class instance. Its reference can stay identical while its visible content mutates in place,
 * so no comparison of references can prove one unchanged: any selection holding one is treated
 * as changed.
 */
const isExotic = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !isPlainObject(value);

/**
 * Own-data-descriptor equality shared by arrays and plain objects, including hidden keys.
 */
const sameKeyedContent = (
    snapshot: object,
    next: object,
    previousToFresh: WeakMap<object, object>,
    freshToPrevious: WeakMap<object, object>
): boolean => {
    const previousKeys = Reflect.ownKeys(snapshot);
    const freshKeys = Reflect.ownKeys(next);

    if (previousKeys.length !== freshKeys.length) {
        return false;
    }

    return previousKeys.every((key: string | symbol): boolean => {
        const previousDescriptor = Object.getOwnPropertyDescriptor(snapshot, key);
        const freshDescriptor = Object.getOwnPropertyDescriptor(next, key);

        if (previousDescriptor === undefined || freshDescriptor === undefined) {
            return false;
        }

        if (
            !Object.prototype.hasOwnProperty.call(previousDescriptor, 'value') ||
            !Object.prototype.hasOwnProperty.call(freshDescriptor, 'value')
        ) {
            throw new Error(
                'sameSelection() cannot compare accessor property ' + String(key) +
                ': select plain data fields instead.'
            );
        }

        if (
            previousDescriptor.enumerable !== freshDescriptor.enumerable ||
            previousDescriptor.configurable !== freshDescriptor.configurable ||
            previousDescriptor.writable !== freshDescriptor.writable
        ) {
            return false;
        }

        // Reads go through a live view's proxy to keep this render's dependency paths intact.
        return sameValue(
            Reflect.get(snapshot, key),
            Reflect.get(next, key),
            previousToFresh,
            freshToPrevious
        );
    });
};

/**
 * Deep, cycle-safe structural equality between a value already handed out (possibly a detached
 * copy) and a freshly read one (possibly still live).
 *
 * A detached copy never shares a reference with the live data it was built from — a fresh
 * container every call, and a fresh proxy for every nested live-view read — so a comparison
 * that stopped at `Object.is` on a nested plain object or array would report a change on every
 * call regardless of content, even when nothing the child can see actually changed. Recursing by
 * own data descriptor — the exact set and flags `detachSelection` copies, arrays' holes,
 * custom properties and true length included — is what makes "same content" and "same handed-out
 * identity" agree at every depth, not only the top one.
 *
 * Content alone is not the whole contract (R5-01): the comparison also preserves the reference
 * sharing `detachSelection` deliberately keeps. The pair maps record how the two graphs are
 * being matched, in both directions, and a mismatch — one previous object claimed by a second,
 * different fresh object, or two previous objects collapsing onto one fresh object — fails the
 * comparison even though every field is equal: a child keying on `selected.left ===
 * selected.right` would otherwise keep a topology that no longer exists. Reusing an
 * established pair is a cycle (or a diamond the walk already resolved) and keeps its verdict.
 *
 * Plain-object prototypes compare too: a null-prototype dictionary and an ordinary object with
 * the same fields detach into different shapes, and a child checking `Object.getPrototypeOf`
 * must see the change.
 *
 * @param a - the value already handed out
 * @param b - the freshly read value to compare it against
 * @param previousToFresh - `a`-side object -> the `b`-side object it is paired with on this
 * call's path, so a cycle reuses that verdict instead of recursing forever
 * @param freshToPrevious - the same pairing in the other direction, so a fresh object already
 * claimed by a different previous object fails instead of comparing by content
 */
const sameValue = (
    a: unknown,
    b: unknown,
    previousToFresh: WeakMap<object, object>,
    freshToPrevious: WeakMap<object, object>
): boolean => {
    // Mutable exotic members are decided before the `Object.is` shortcut (R5-02): the same Map
    // instance on both sides can have been mutated in place between the two reads, so identity
    // equality proves nothing and the selection is treated as changed. This is the one
    // deliberately imprecise branch — a selection can project an exotic member into plain data
    // (an array of entries, say) to keep precise memoization.
    if (isExotic(a) || isExotic(b)) {
        return false;
    }

    if (Object.is(a, b)) {
        return true;
    }

    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return false;
    }

    const mapped = previousToFresh.get(a);

    if (mapped !== undefined) {
        return mapped === b;
    }

    if (freshToPrevious.get(b) !== undefined) {
        return false;
    }

    if (Array.isArray(a) || Array.isArray(b)) {
        if (
            !Array.isArray(a) || !Array.isArray(b) ||
            a.length !== b.length || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)
        ) {
            return false;
        }

        previousToFresh.set(a, b);
        freshToPrevious.set(b, a);

        return sameKeyedContent(a, b, previousToFresh, freshToPrevious);
    }

    if (!isPlainObject(a) || !isPlainObject(b)) {
        return false;
    }

    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
        return false;
    }

    previousToFresh.set(a, b);
    freshToPrevious.set(b, a);

    return sameKeyedContent(a, b, previousToFresh, freshToPrevious);
};

/**
 * Whether a fresh selection has the same content as the snapshot already handed out, so "same"
 * here means the handed-out snapshot may keep its identity — and the gated child keeps its
 * bail-out.
 *
 * The comparison walks the whole selected structure on every call (R5-07): the selector must run
 * per render to renew its read tracking, and a detached snapshot can never short-circuit against
 * the fresh read by reference. Skipping the walk while the store version has not moved would
 * assume the selector reads nothing but store data, which a selector capturing a changing prop
 * quietly violates — small projections stay the answer for frequently rerendered parents.
 *
 * @param snapshot - the snapshot already handed out, possibly detached from its source
 * @param next - the fresh selection to compare it against
 */
export const sameSelection = (snapshot: unknown, next: unknown): boolean =>
    sameValue(snapshot, next, new WeakMap<object, object>(), new WeakMap<object, object>());
