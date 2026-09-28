import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/**
 * A detached copy of plain data.
 *
 * Only plain objects and arrays are copied — the same boundary the tracking proxies use.
 * Anything else (Map, Set, Date, class instances) is carried over by reference, because the
 * engine does not track it field by field either. Keys are copied by plain assignment, except
 * an own key literally named `__proto__`, which needs `Object.defineProperty` to land as a
 * data property instead of reassigning the target's prototype.
 */
export const deepClone = <T>(value: T): T => {
    if (!isTrackable(value)) {
        return value;
    }

    if (Array.isArray(value)) {
        const length: number = value.length;
        // Holes stay holes, as with `map`.
        const result: unknown[] = [];
        result.length = length;

        for (let index = 0; index < length; index++) {
            if (index in value) {
                result[index] = deepClone(value[index]);
            }
        }

        return result as unknown as T;
    }

    const source = value as Record<string | symbol, unknown>;
    // Object.create(getPrototypeOf(source)) keeps a null-prototype dictionary null-prototype
    // instead of always landing on Object.prototype the way `{}` would.
    const result: Record<string | symbol, unknown> = Object.create(Object.getPrototypeOf(source));
    const keys: Array<string | symbol> = Reflect.ownKeys(source);

    for (let i = 0; i < keys.length; i++) {
        const key: string | symbol = keys[i];

        if (!Object.prototype.propertyIsEnumerable.call(source, key)) {
            continue;
        }

        const cloned: unknown = deepClone(source[key]);

        if (key === '__proto__') {
            Object.defineProperty(result, key, {value: cloned, writable: true, enumerable: true, configurable: true});
        } else {
            result[key] = cloned;
        }
    }

    return result as unknown as T;
};
