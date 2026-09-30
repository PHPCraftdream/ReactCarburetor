import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {liveViews} from "@/Carburetor/Store/Tracking/liveViews";

/**
 * Copies an own data descriptor without invoking an accessor. Accessors cannot make
 * stable snapshots, so they are rejected with an actionable error.
 */
const detachedDescriptor = (
    source: object,
    key: string | symbol,
    seen: WeakMap<object, unknown>,
    onLiveInstance: TReportLiveInstance | undefined,
    onArraySubclass: TArraySubclassGuard | undefined,
    descriptorSource: object = source
): PropertyDescriptor | undefined => {
    // A forwarding facade relaxes non-configurable descriptors to satisfy its empty
    // Proxy target. Read the trusted raw descriptor to retain the original flags, but
    // traverse the facade below so each selected field still records its path.
    const descriptor = Object.getOwnPropertyDescriptor(descriptorSource, key);

    if (!descriptor) {
        return undefined;
    }

    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new Error(
            (onArraySubclass === undefined ? 'detachOpaque()' : 'detachSelection()') +
            ' cannot snapshot accessor property ' + String(key) +
            ': select plain data fields instead.'
        );
    }

    // A data-property read lets the store's read proxy record the selected path.
    descriptor.value = detach(Reflect.get(source, key), seen, onLiveInstance, onArraySubclass);

    return descriptor;
};

/** The per-instance report a caller can wire in: fired for each live class instance handed over. */
type TReportLiveInstance = (instance: object) => void;

/** Optional stricter array policy used by class connection selections. */
type TArraySubclassGuard = (instance: object) => never;

/**
 * Copies native own data fields after their intrinsic contents, using the same cycle ledger
 * so a hidden field can refer back to the native copy or across its keys and members.
 */
const copyNativeFields = (
    source: object,
    copy: object,
    seen: WeakMap<object, unknown>,
    onLiveInstance: TReportLiveInstance | undefined,
    onArraySubclass: TArraySubclassGuard | undefined
): void => {
    const keys = Reflect.ownKeys(source);

    for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        const descriptor = detachedDescriptor(source, key, seen, onLiveInstance, onArraySubclass);

        if (descriptor) {
            Object.defineProperty(copy, key, descriptor);
        }
    }
};

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
    onLiveInstance: TReportLiveInstance | undefined,
    onArraySubclass: TArraySubclassGuard | undefined
): unknown => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const target = liveViews.readTarget(value);
    const known = seen.get(target ?? value);

    if (known !== undefined) {
        if (target !== undefined && !seen.has(value)) {
            // The raw branch may have been copied first through an opaque Map. Still visit
            // this recognized read proxy once: its field reads subscribe to the selected
            // paths, including descendants, without making a second detached copy.
            seen.set(value, known);
            Reflect.ownKeys(value).forEach((key: string | symbol): void => {
                if (!Array.isArray(value) || key !== 'length') {
                    detachedDescriptor(value, key, seen, onLiveInstance, onArraySubclass, target);
                }
            });
        }

        return known;
    }

    // A persistent facade can front a native root, but native methods require their real
    // internal-slot receiver. Its registered resolver already recorded the root wildcard.
    const native = target ?? value;

    // Exact prototype: a subclass falls through to the class-instance guard, not a lossy rebuild.
    if (native instanceof Date && Object.getPrototypeOf(native) === Date.prototype) {
        const copy = new Date(Date.prototype.getTime.call(native));

        seen.set(value, copy);
        if (target !== undefined) {
            seen.set(target, copy);
        }

        copyNativeFields(native, copy, seen, onLiveInstance, onArraySubclass);

        return copy;
    }

    if (native instanceof Map && Object.getPrototypeOf(native) === Map.prototype) {
        const copy = new Map<unknown, unknown>();

        seen.set(value, copy);
        if (target !== undefined) {
            seen.set(target, copy);
        }

        Map.prototype.forEach.call(native, (member: unknown, key: unknown): void => {
            copy.set(detach(key, seen, onLiveInstance, onArraySubclass),
                detach(member, seen, onLiveInstance, onArraySubclass));
        });

        copyNativeFields(native, copy, seen, onLiveInstance, onArraySubclass);

        return copy;
    }

    if (native instanceof Set && Object.getPrototypeOf(native) === Set.prototype) {
        const copy = new Set<unknown>();

        seen.set(value, copy);
        if (target !== undefined) {
            seen.set(target, copy);
        }

        Set.prototype.forEach.call(native, (member: unknown): void => {
            copy.add(detach(member, seen, onLiveInstance, onArraySubclass));
        });

        copyNativeFields(native, copy, seen, onLiveInstance, onArraySubclass);

        return copy;
    }

    if (Array.isArray(value)) {
        const prototype = Object.getPrototypeOf(value);

        if (prototype !== Array.prototype && prototype !== Object.prototype && prototype !== null) {
            // A subclass cannot be forged into a plain array for a class connection.
            // Other consumers keep unsupported array instances live, as before.
            if (onArraySubclass !== undefined) {
                onArraySubclass(value);
            }

            onLiveInstance?.(value);

            return value;
        }

        const copy: unknown[] = prototype === Array.prototype
            ? []
            : Object.setPrototypeOf([], prototype);

        seen.set(value, copy);

        if (target !== undefined) {
            seen.set(target, copy);
        }

        // Defining data descriptors preserves holes and flags without invoking indexed getters.
        Reflect.ownKeys(value).forEach((key: string | symbol): void => {
            if (key !== 'length') {
                const descriptor = detachedDescriptor(value, key, seen, onLiveInstance, onArraySubclass, target);

                if (descriptor) {
                    Object.defineProperty(copy, key, descriptor);
                }
            }
        });

        // A persistent array facade reports writable length even when the current raw
        // array is locked, as required by its shared Proxy target. Copy the real flags.
        const length = Object.getOwnPropertyDescriptor(native, 'length');

        if (length) {
            Object.defineProperty(copy, 'length', length);
        }

        return copy;
    }

    if (!isTrackable(value)) {
        // A class instance has no generic safe copy: fields can be private, the prototype carries
        // behavior, and a structural copy would break every identity its methods rely on. It is
        // handed over live, and the caller can ask to hear about it.
        onLiveInstance?.(value);

        return value;
    }

    const source = value as Record<string | symbol, unknown>;
    // Object.create(getPrototypeOf(source)) keeps a null-prototype dictionary null-prototype
    // instead of always landing on Object.prototype the way `{}` would.
    const result: Record<string | symbol, unknown> = Object.create(Object.getPrototypeOf(source));

    seen.set(value, result);

    if (target !== undefined) {
        seen.set(target, result);
    }

    Reflect.ownKeys(source).forEach((key: string | symbol): void => {
        const descriptor = detachedDescriptor(source, key, seen, onLiveInstance, onArraySubclass, target);

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
 * A class instance — anything else with a prototype of its own, including a Map/Set/Date
 * subclass — has no generic safe copy and passes through live, at the root and nested alike;
 * `onLiveInstance` lets the caller hear about each one. A recognized tracked read proxy and
 * its raw branch share one detached copy, including when the raw branch is visited first via
 * a Map; only the original source key still misses lookups into the detached Map.
 *
 * @param value - the value to detach
 * @param onLiveInstance - optional report fired for each live class instance the copy has to hand
 * over, at any depth
 * @param onArraySubclass - optional rejection policy for class selections
 * @returns the detached copy
 */
export const detachOpaque = <T>(
    value: T,
    onLiveInstance?: TReportLiveInstance,
    onArraySubclass?: TArraySubclassGuard
): T => detach(value, new WeakMap<object, unknown>(), onLiveInstance, onArraySubclass) as T;
