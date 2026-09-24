import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/**
 * Copies an own data descriptor without invoking an accessor. Accessors cannot make
 * stable snapshots, so they are rejected with an actionable error.
 */
const detachedDescriptor = (
    source: object,
    key: string | symbol,
    seen: WeakMap<object, unknown>,
    onLiveInstance: TReportLiveInstance | undefined
): PropertyDescriptor | undefined => {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);

    if (!descriptor) {
        return undefined;
    }

    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new Error(
            'detachOpaque() cannot snapshot accessor property ' + String(key) +
            ': select plain data fields instead.'
        );
    }

    // A data-property read lets the store's read proxy record the selected path.
    descriptor.value = detach(Reflect.get(source, key), seen, onLiveInstance);

    return descriptor;
};

/** The per-instance report a caller can wire in: fired for each live class instance handed over. */
type TReportLiveInstance = (instance: object) => void;

/**
 * One recursive step, split from the export only so the entry point can hand a fresh cycle guard.
 *
 * Every copied container is registered in `seen` before its members are walked, so a source value
 * reached along two paths — including through its own cycle — reuses the copy already under
 * construction instead of recursing forever.
 */
const detach = (
    value: unknown,
    seen: WeakMap<object, unknown>,
    onLiveInstance: TReportLiveInstance | undefined
): unknown => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const known = seen.get(value);

    if (known !== undefined) {
        return known;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (value instanceof Map) {
        const copy = new Map<unknown, unknown>();

        seen.set(value, copy);

        value.forEach((member: unknown, key: unknown): void => {
            copy.set(detach(key, seen, onLiveInstance), detach(member, seen, onLiveInstance));
        });

        return copy;
    }

    if (value instanceof Set) {
        const copy = new Set<unknown>();

        seen.set(value, copy);

        value.forEach((member: unknown): void => {
            copy.add(detach(member, seen, onLiveInstance));
        });

        return copy;
    }

    if (!isTrackable(value)) {
        // A class instance has no generic safe copy: fields can be private, the prototype carries
        // behavior, and a structural copy would break every identity its methods rely on. It is
        // handed over live, and the caller can ask to hear about it.
        onLiveInstance?.(value);

        return value;
    }

    if (Array.isArray(value)) {
        const copy: unknown[] = [];

        seen.set(value, copy);

        // Defining data descriptors preserves holes and flags without invoking indexed getters.
        Reflect.ownKeys(value).forEach((key: string | symbol): void => {
            if (key !== 'length') {
                const descriptor = detachedDescriptor(value, key, seen, onLiveInstance);

                if (descriptor) {
                    Object.defineProperty(copy, key, descriptor);
                }
            }
        });

        const length = Object.getOwnPropertyDescriptor(value, 'length');

        if (length) {
            Object.defineProperty(copy, 'length', length);
        }

        return copy;
    }

    const source = value as Record<string | symbol, unknown>;
    // Object.create(getPrototypeOf(source)) keeps a null-prototype dictionary null-prototype
    // instead of always landing on Object.prototype the way `{}` would.
    const result: Record<string | symbol, unknown> = Object.create(Object.getPrototypeOf(source));

    seen.set(value, result);

    Reflect.ownKeys(source).forEach((key: string | symbol): void => {
        const descriptor = detachedDescriptor(source, key, seen, onLiveInstance);

        if (descriptor) {
            Object.defineProperty(result, key, descriptor);
        }
    });

    return result;
};

/**
 * Recursively detaches plain objects, arrays, Maps, Sets and Dates.
 * Own string and symbol data descriptors are preserved; accessors are rejected without invocation.
 *
 * A null-prototype dictionary stays null-prototype. An accessor cannot produce a detached
 * snapshot because its value may remain connected to mutable source state.
 *
 * That is the boundary `deepClone` deliberately does not provide: the store's own
 * snapshot/restore round trip carries opaque values by reference, while a React snapshot handed to
 * `useSyncExternalStore` must stay immutable under in-place mutation.
 *
 * A class instance — anything else with a prototype of its own — has no generic safe copy and
 * passes through live, at the root and nested alike; `onLiveInstance` lets the caller hear about
 * each one. A detached Map key is a new object, so a lookup into the copy with the original key
 * object misses: read through the copy's own keys.
 *
 * @param value - the value to detach
 * @param onLiveInstance - optional report fired for each live class instance the copy has to hand
 * over, at any depth
 * @returns the detached copy
 */
export const detachOpaque = <T>(value: T, onLiveInstance?: TReportLiveInstance): T =>
    detach(value, new WeakMap<object, unknown>(), onLiveInstance) as T;
