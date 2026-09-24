import {isPlainObject} from "./isPlainObject";
/**
 * Copies one own data descriptor without invoking an accessor.
 *
 * @param source - the container whose property is copied
 * @param key - the property key to read
 * @param seen - source containers and their in-progress copies
 */
const detachedDescriptor = (
    source: object,
    key: string | symbol,
    seen: WeakMap<object, unknown>
): PropertyDescriptor | undefined => {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);

    if (descriptor === undefined) {
        return undefined;
    }

    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new Error(
            'detachSelection() cannot snapshot accessor property ' + String(key) +
            ': select plain data fields instead.'
        );
    }

    // Read through the view proxy so selecting this descriptor keeps render tracking precise.
    descriptor.value = detachDeep(Reflect.get(source, key), seen);

    return descriptor;
};

/**
 * Deep, cycle-safe detachment of one value: plain objects and arrays are walked recursively and
 * rebuilt as fresh containers, at any depth, with all own string and symbol data descriptors.
 * Accessors are rejected without invoking their getters.
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

    // Preserve null-prototype dictionaries and custom array prototypes.
    const target: Record<string | symbol, unknown> | unknown[] = isArray
        ? Object.setPrototypeOf([], Object.getPrototypeOf(value)) as unknown[]
        : Object.create(Object.getPrototypeOf(value));

    seen.set(value, target);

    const source = value as Record<string | symbol, unknown>;

    Reflect.ownKeys(value).forEach((key: string | symbol): void => {
        if (isArray && key === 'length') {
            return;
        }

        const descriptor = detachedDescriptor(source, key, seen);

        if (descriptor !== undefined) {
            Object.defineProperty(target, key, descriptor);
        }
    });

    if (isArray) {
        const length = Object.getOwnPropertyDescriptor(value, 'length');

        if (length !== undefined) {
            Object.defineProperty(target, 'length', length);
        }
    }

    return target;
};

/**
 * The detached form of a selection's value — the form safe to hand a child, at any depth.
 *
 * @see detachDeep for the descriptor policy; this entry point supplies a fresh cycle guard.
 */
export const detachSelection = (value: unknown): unknown => detachDeep(value, new WeakMap<object, unknown>());
