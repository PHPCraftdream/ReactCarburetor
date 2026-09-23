import {isPlainObject} from "./isPlainObject";
import {ownEnumerableKeys} from "./ownEnumerableKeys";

/**
 * Deep, cycle-safe detachment of one value: plain objects and arrays are walked recursively and
 * rebuilt as fresh containers, at any depth, own enumerable string and symbol keys included.
 *
 * A live connect()/connectSelection() branch reached along the way answers the same shape
 * questions as a plain container (its facade mimics `Object.prototype`/array-ness exactly, see
 * `buildPersistentView`), so it is walked the same way as one — reading each of its keys through
 * `Reflect.get`, the same access its tracking recorder already answers to. That read happens
 * while the owner's render attempt this call is nested in is still open, so it also records
 * whatever deeper path the plain copy actually needed — the same subscription a direct read at
 * that depth would have recorded. What comes back holds no reference into the store: every
 * container in the result is one this call built.
 *
 * A source object already on the current path is reused instead of walked again: the only way
 * this recursion could fail to terminate is a cycle the selection's own data introduced, since a
 * live view's own branches are never revisited (each nested read produces a fresh proxy).
 *
 * @param value - the candidate to detach
 * @param seen - source object -> its already-built copy, so a cycle reuses the in-progress copy
 * instead of recursing forever
 */
const detachDeep = (value: unknown, seen: WeakMap<object, unknown>): unknown => {
    if (typeof value !== 'object' || value === null) {
        return value;
    }

    if (seen.has(value)) {
        return seen.get(value);
    }

    const isArray = Array.isArray(value);

    if (!isArray && !isPlainObject(value)) {
        // Exotic objects (Map, Date, class instances) would lose their prototype to a copy, so
        // they — and whatever they hold — pass through untouched, exactly as before.
        return value;
    }

    const target: Record<string | symbol, unknown> | unknown[] = isArray ? [] : {};

    seen.set(value, target);

    const source = value as Record<string | symbol, unknown>;

    ownEnumerableKeys(value).forEach((key: string | symbol): void => {
        (target as Record<string | symbol, unknown>)[key] = detachDeep(source[key], seen);
    });

    return target;
};

/**
 * The detached form of a selection's value — the form safe to hand a child, at any depth.
 *
 * @see detachDeep for what "detached" means at each level; this is only its entry point, with a
 * fresh cycle guard per call.
 */
export const detachSelection = (value: unknown): unknown => detachDeep(value, new WeakMap<object, unknown>());
