import {isPlainObject} from "./isPlainObject";
import {ownEnumerableKeys} from "./ownEnumerableKeys";

/**
 * Installs `key` as a genuine own data property, bypassing any inherited accessor a plain
 * `target[key] = value` assignment would invoke instead — the case that matters is a source
 * object with an own enumerable key literally named `__proto__`: assigning it would reset the
 * target's prototype rather than store the value. Same policy `deepClone` uses for its own
 * container copies, so a source's shape survives a copy identically either way.
 */
const definePlainProperty = (target: object, key: string | symbol, value: unknown): void => {
    Object.defineProperty(target, key, {value, writable: true, enumerable: true, configurable: true});
};

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
        // they — and whatever they hold — pass through untouched, exactly as before. Their
        // identity can survive an in-place mutation, which is why `sameSelection` treats any
        // selection holding one as changed instead of trusting `Object.is`.
        return value;
    }

    // Object.create(getPrototypeOf(value)) keeps a null-prototype dictionary null-prototype
    // instead of always landing on Object.prototype the way `{}` would; arrays keep the plain
    // Array.prototype shape a `[]` literal already has.
    const target: Record<string | symbol, unknown> | unknown[] =
        isArray ? [] : Object.create(Object.getPrototypeOf(value));

    seen.set(value, target);

    const source = value as Record<string | symbol, unknown>;

    ownEnumerableKeys(value).forEach((key: string | symbol): void => {
        definePlainProperty(target, key, detachDeep(source[key], seen));
    });

    if (isArray) {
        // Own enumerable keys skip holes, so a sparse source's true length would otherwise be
        // lost — the highest defined index alone would understate it.
        (target as unknown[]).length = (value as unknown[]).length;
    }

    return target;
};

/**
 * The detached form of a selection's value — the form safe to hand a child, at any depth.
 *
 * @see detachDeep for what "detached" means at each level; this is only its entry point, with a
 * fresh cycle guard per call.
 */
export const detachSelection = (value: unknown): unknown => detachDeep(value, new WeakMap<object, unknown>());
