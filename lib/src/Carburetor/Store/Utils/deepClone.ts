import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/**
 * Installs `key` as a genuine own data property, bypassing any inherited accessor a plain
 * `target[key] = value` assignment would invoke instead — the case that matters is a source
 * object with an own enumerable key literally named `__proto__`: assigning it would reset the
 * target's prototype rather than store the value.
 */
const definePlainProperty = (target: object, key: string, value: unknown): void => {
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

    const source = value as Record<string, unknown>;
    // Object.create(getPrototypeOf(source)) keeps a null-prototype dictionary null-prototype
    // instead of always landing on Object.prototype the way `{}` would.
    const result: Record<string, unknown> = Object.create(Object.getPrototypeOf(source));

    Object.keys(source).forEach((key: string) => {
        definePlainProperty(result, key, deepClone(source[key]));
    });

    return result as unknown as T;
};
