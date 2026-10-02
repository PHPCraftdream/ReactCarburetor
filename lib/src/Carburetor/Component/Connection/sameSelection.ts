import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
import {isPlainObject} from "./isPlainObject";

const hasPrototype = (value: object, prototype: object): boolean =>
    Object.getPrototypeOf(value) === prototype;

/** A Date whose visible content is exactly its time — a Date subclass is a class instance. */
const isPlainDate = (value: object): boolean => hasPrototype(value, Date.prototype);

/** A Map without own behavior — a Map subclass is a class instance. */
const isPlainMap = (value: object): boolean => hasPrototype(value, Map.prototype);

/** A Set without own behavior — a Set subclass is a class instance. */
const isPlainSet = (value: object): boolean => hasPrototype(value, Set.prototype);

/**
 * A class instance: nothing the selection model defines a copy for (R6-02). Its reference can
 * stay identical while its fields mutate in place, and `connectSelection` hands such instances
 * over live — no comparison can prove one unchanged, so any selection holding one is treated
 * as changed. Decided before the `Object.is` shortcut.
 */
const isClassInstance = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !isPlainObject(value) &&
    !isPlainDate(value) && !isPlainMap(value) && !isPlainSet(value);

/** Whether a Map key can be matched across a detached copy and the live value: primitives only. */
const isMatchableKey = (key: unknown): boolean => key === null || typeof key !== 'object';

/**
 * Own enumerable string keys and their values — the whole of a plain object in the selection
 * model. Key order participates: equal content in a new insertion order is a change (integer
 * keys have native numeric order regardless of insertion order).
 *
 * Values are still read on both sides even after a mismatch, so a returned live branch stays
 * subscribed to its leaves for the next publication.
 */
const sameKeyedContent = (
    snapshot: object,
    next: object,
    previousToFresh: WeakMap<object, object>,
    freshToPrevious: WeakMap<object, object>
): boolean => {
    const previousKeys = Object.keys(snapshot);
    const freshKeys = Object.keys(next);

    if (previousKeys.length !== freshKeys.length) {
        return false;
    }

    let sameOrder = true;

    for (let index = 0; index < previousKeys.length; index++) {
        if (previousKeys[index] !== freshKeys[index]) sameOrder = false;
    }

    let sameContent = true;

    for (let index = 0; index < previousKeys.length; index++) {
        const key = previousKeys[index];

        if (!sameValue(
            (snapshot as Record<string, unknown>)[key],
            Reflect.get(next, key),
            previousToFresh,
            freshToPrevious
        )) {
            sameContent = false;
        }
    }

    return sameOrder && sameContent;
};
/** Array index properties are the canonical integer keys below the array-index limit. */
const isArrayIndex = (key: PropertyKey): key is string => {
    if (typeof key !== 'string') {
        return false;
    }

    const index = Number(key);

    return Number.isInteger(index) && index >= 0 && index < 0xFFFFFFFF && String(index) === key;
};

/** SameValueZero is the equality used by native Map keys and Set members. */
const sameValueZero = (a: unknown, b: unknown): boolean =>
    a === b || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b));
/**
 * Dense prefixes keep the per-index fast path. At the first hole, ownKeys records a structural
 * read and ordered index traversal compares the remaining sparse slots without scanning length.
 */
const sameArrayContent = (
    snapshot: unknown[],
    next: unknown[],
    previousToFresh: WeakMap<object, object>,
    freshToPrevious: WeakMap<object, object>
): boolean => {
    let same = true;
    let densePrefix = 0;

    for (; densePrefix < snapshot.length; densePrefix++) {
        const hasPrevious = Object.prototype.hasOwnProperty.call(snapshot, densePrefix);
        const hasNext = Object.prototype.hasOwnProperty.call(next, densePrefix);

        if (!hasPrevious || !hasNext) {
            if (hasPrevious !== hasNext) same = false;

            break;
        }

        if (!sameValue(snapshot[densePrefix], Reflect.get(next, densePrefix), previousToFresh, freshToPrevious)) {
            same = false;
        }
    }

    if (densePrefix === snapshot.length) {
        return same;
    }

    const previousKeys = Reflect.ownKeys(snapshot);
    const freshKeys = Reflect.ownKeys(next);
    let previousIndex = densePrefix;
    let freshIndex = densePrefix;

    while (true) {
        while (previousIndex < previousKeys.length && !isArrayIndex(previousKeys[previousIndex])) {
            previousIndex++;
        }

        while (freshIndex < freshKeys.length && !isArrayIndex(freshKeys[freshIndex])) {
            freshIndex++;
        }

        const hasPrevious = previousIndex < previousKeys.length && isArrayIndex(previousKeys[previousIndex]);
        const hasFresh = freshIndex < freshKeys.length && isArrayIndex(freshKeys[freshIndex]);

        if (!hasPrevious && !hasFresh) {
            return same;
        }

        if (!hasPrevious) {
            same = false;
            Reflect.get(next, freshKeys[freshIndex] as string);
            freshIndex++;

            continue;
        }

        if (!hasFresh) {
            same = false;
            previousIndex++;

            continue;
        }

        const previousKey = previousKeys[previousIndex] as string;
        const freshKey = freshKeys[freshIndex] as string;
        const previousNumericIndex = Number(previousKey);
        const freshNumericIndex = Number(freshKey);

        if (previousKey === freshKey) {
            if (!sameValue(
                snapshot[previousNumericIndex],
                Reflect.get(next, freshKey),
                previousToFresh,
                freshToPrevious
            )) {
                same = false;
            }

            previousIndex++;
            freshIndex++;
        } else if (previousNumericIndex < freshNumericIndex) {
            same = false;
            previousIndex++;
        } else {
            same = false;
            Reflect.get(next, freshKey);
            freshIndex++;
        }
    }
};
/** A detached Date equals the live one when the timestamps are Object.is-equal. */
const sameDateContent = (snapshot: Date, next: Date): boolean =>
    Object.is(Date.prototype.getTime.call(snapshot), Date.prototype.getTime.call(next));
/**
 * Map/Set equality follows intrinsic iteration order. Primitive keys/members use SameValueZero;
 * Map values recurse through the selection comparison. Object keys remain conservatively changed.
 */
const sameNativeContent = (
    snapshot: Map<unknown, unknown> | Set<unknown>,
    next: Map<unknown, unknown> | Set<unknown>,
    previousToFresh: WeakMap<object, object>,
    freshToPrevious: WeakMap<object, object>
): boolean => {
    if (snapshot instanceof Map) {
        const nextMap = next as Map<unknown, unknown>;

        if (snapshot.size !== nextMap.size) {
            return false;
        }

        previousToFresh.set(snapshot, nextMap);
        freshToPrevious.set(nextMap, snapshot);

        const freshKeys = Map.prototype.keys.call(nextMap) as IterableIterator<unknown>;
        let same = true;

        Map.prototype.forEach.call(snapshot, (previousValue: unknown, previousKey: unknown): void => {
            const freshKey = freshKeys.next();

            if (freshKey.done) {
                same = false;

                return;
            }

            if (!isMatchableKey(previousKey) || !isMatchableKey(freshKey.value)) {
                same = false;

                return;
            }

            if (!sameValueZero(previousKey, freshKey.value)) {
                same = false;
            }

            if (!sameValue(
                previousValue,
                Map.prototype.get.call(nextMap, previousKey),
                previousToFresh,
                freshToPrevious
            )) {
                same = false;
            }
        });

        return same && freshKeys.next().done === true;
    }

    const previousSet = snapshot as Set<unknown>;
    const nextSet = next as Set<unknown>;

    if (previousSet.size !== nextSet.size) {
        return false;
    }

    previousToFresh.set(previousSet, nextSet);
    freshToPrevious.set(nextSet, previousSet);

    const previousMembers = Set.prototype.values.call(previousSet) as IterableIterator<unknown>;
    const freshMembers = Set.prototype.values.call(nextSet) as IterableIterator<unknown>;
    let same = true;

    while (true) {
        const previousMember = previousMembers.next();
        const freshMember = freshMembers.next();

        if (previousMember.done || freshMember.done) {
            return same && previousMember.done === freshMember.done;
        }

        if (!isMatchableKey(previousMember.value) || !isMatchableKey(freshMember.value) ||
            !sameValueZero(previousMember.value, freshMember.value)) {
            same = false;
        }
    }
};

/**
 * Deep, cycle-safe structural equality between a value already handed out (possibly a detached
 * copy) and a freshly read one (possibly still live).
 *
 * The comparison follows the state model (R6-02, R30-04): a plain object is its own enumerable
 * string keys and values, an array is its elements and `length`, a Date/Map/Set is a detached
 * copy whose content can be compared, and anything else is a class instance and always counts
 * as changed. Descriptor flags, symbol keys and non-enumerable keys are not part of a
 * selection and take no part in the comparison.
 *
 * A detached copy never shares a reference with the live data it was built from — a fresh
 * container every call, and a fresh proxy for every nested live-view read — so a comparison
 * that stopped at `Object.is` on a nested plain object or array would report a change on every
 * call regardless of content, even when nothing the child can see actually changed.
 *
 * Content alone is not the whole contract (R5-01): the comparison also preserves the reference
 * sharing `detachSelection` deliberately keeps. The pair maps record how the two graphs are
 * being matched, in both directions, and a mismatch — one previous object claimed by a second,
 * different fresh object, or two previous objects collapsing onto one fresh object — fails the
 * comparison even though every field is equal: a child keying on `selected.left ===
 * selected.right` would otherwise keep a topology that no longer exists. Reusing an
 * established pair is a cycle (or a diamond the walk already resolved) and keeps its verdict;
 * detached Date/Map/Set pairs register in the same maps.
 *
 * Plain-object prototypes compare too: a null-prototype dictionary and an ordinary object with
 * the same fields detach into different shapes, and a child checking `Object.getPrototypeOf`
 * must see the change.
 *
 * @param a - the value already handed out
 * @param b - the freshly read value to compare it against
 * @param previousToFresh - previous-side object -> canonical fresh graph member paired on this call,
 * so engine facades for the same value reuse a graph pair
 * @param freshToPrevious - canonical fresh graph member -> previous-side object, so two previous
 * objects cannot collapse onto one fresh member without a topology mismatch
 */
const sameValue = (
    a: unknown,
    b: unknown,
    previousToFresh?: WeakMap<object, object>,
    freshToPrevious?: WeakMap<object, object>
): boolean => {
    if (isClassInstance(a) || isClassInstance(b)) {
        return false;
    }

    if (Object.is(a, b)) {
        return true;
    }

    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return false;
    }

    // Pair-map identity is the raw graph member, but structural reads below stay on `b` so
    // tracked plain/array facades still record the paths they inspect.
    const freshIdentity = liveViews.readTarget(b) ?? b;

    // Minted here, at the first container pair, not by sameSelection up front (R16-09): a
    // primitive comparison returns above and never pays for these. Once created, the same pair
    // threads through the whole recursion, so cycle detection still spans the call.
    const previous = previousToFresh ?? new WeakMap<object, object>();
    const fresh = freshToPrevious ?? new WeakMap<object, object>();

    const mapped = previous.get(a);

    if (mapped !== undefined) {
        return mapped === freshIdentity;
    }

    if (fresh.get(freshIdentity) !== undefined) {
        return false;
    }

    if (Array.isArray(a) || Array.isArray(b)) {
        // `a` (already handed out) can never be an Array subclass — detachSelection() rejects one
        // before a snapshot holding it is ever built (R12-01) — so a fresh `b` that is one always
        // fails this prototype check and falls through to that same rejection instead of being
        // reported "same" or silently forged here.
        if (
            !Array.isArray(a) || !Array.isArray(b) ||
            a.length !== b.length || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)
        ) {
            return false;
        }

        previous.set(a, freshIdentity);
        fresh.set(freshIdentity, a);
        return sameArrayContent(a, b, previous, fresh);
    }

    if (isPlainObject(a) && isPlainObject(b)) {
        if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
            return false;
        }

        previous.set(a, freshIdentity);
        fresh.set(freshIdentity, a);

        return sameKeyedContent(a, b, previous, fresh);
    }

    if (
        ((isPlainDate(a) && isPlainDate(b)) ||
            (isPlainMap(a) && isPlainMap(b)) ||
            (isPlainSet(a) && isPlainSet(b)))
    ) {
        // Native methods need their real internal-slot receiver, so a fresh side that is a
        // tracked facade compares through its raw target; the facade read itself was what
        // recorded the selected path.
        const rawB = freshIdentity;

        if (isPlainDate(a)) {
            previous.set(a, rawB);
            fresh.set(rawB, a);

            return sameDateContent(a as Date, rawB as Date);
        }

        return sameNativeContent(a as Map<unknown, unknown>, rawB as Map<unknown, unknown>, previous, fresh);
    }

    return false;
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
    sameValue(snapshot, next);
