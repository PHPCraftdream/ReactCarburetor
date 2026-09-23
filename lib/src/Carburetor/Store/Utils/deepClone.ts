import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/**
 * The own enumerable keys of a plain container — strings and symbols alike, in `Reflect.ownKeys`
 * order. Written locally rather than imported from Component/Connection: Store must not reach
 * into Component, and `detachSelection`'s helper is exactly this filter.
 */
const ownEnumerableKeys = (source: object): Array<string | symbol> =>
    Reflect.ownKeys(source).filter((key: string | symbol): boolean =>
        Object.prototype.propertyIsEnumerable.call(source, key));

/**
 * Installs `key` as a genuine own data property, bypassing any inherited accessor a plain
 * `target[key] = value` assignment would invoke instead — the case that matters is a source
 * object with an own enumerable key literally named `__proto__`: assigning it would reset the
 * target's prototype rather than store the value.
 */
const definePlainProperty = (target: object, key: string | symbol, value: unknown): void => {
    Object.defineProperty(target, key, {value, writable: true, enumerable: true, configurable: true});
};

/**
 * A detached copy of plain data.
 *
 * Only plain objects and arrays are copied — the same boundary the tracking proxies use.
 * Anything else (Map, Set, Date, class instances) is carried over by reference, because the
 * engine does not track it field by field either.
 */
export const deepClone = <T>(value: T): T => {
    if (!isTrackable(value)) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item: unknown) => deepClone(item)) as unknown as T;
    }

    const source = value as Record<string | symbol, unknown>;
    // Object.create(getPrototypeOf(source)) keeps a null-prototype dictionary null-prototype
    // instead of always landing on Object.prototype the way `{}` would.
    const result: Record<string | symbol, unknown> = Object.create(Object.getPrototypeOf(source));

    ownEnumerableKeys(source).forEach((key: string | symbol): void => {
        definePlainProperty(result, key, deepClone(source[key]));
    });

    return result as unknown as T;
};
