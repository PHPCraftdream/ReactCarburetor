import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/**
 * The own enumerable keys of a plain container — strings and symbols alike, in `Reflect.ownKeys`
 * order. Written locally rather than imported from Component/Connection: Store must not reach
 * into Component, and `deepClone`'s helper is exactly this filter.
 */
const ownEnumerableKeys = (source: object): Array<string | symbol> =>
    Reflect.ownKeys(source).filter((key: string | symbol): boolean =>
        Object.prototype.propertyIsEnumerable.call(source, key));

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

        // forEach skips holes and index assignment keeps them, so a sparse source stays sparse;
        // the full length is restored in case the highest defined index alone would understate it.
        value.forEach((item: unknown, index: number): void => {
            copy[index] = detach(item, seen, onLiveInstance);
        });

        copy.length = value.length;

        return copy;
    }

    const source = value as Record<string | symbol, unknown>;
    // Object.create(getPrototypeOf(source)) keeps a null-prototype dictionary null-prototype
    // instead of always landing on Object.prototype the way `{}` would.
    const result: Record<string | symbol, unknown> = Object.create(Object.getPrototypeOf(source));

    seen.set(value, result);

    ownEnumerableKeys(source).forEach((key: string | symbol): void => {
        definePlainProperty(result, key, detach(source[key], seen, onLiveInstance));
    });

    return result;
};

/**
 * A fully detached copy of a value: plain objects, arrays, Maps, Sets and Dates are all rebuilt at
 * any depth — inside a plain container, a Map or Set, or a Map key — own enumerable string and
 * symbol keys included, a null-prototype dictionary staying null-prototype.
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
