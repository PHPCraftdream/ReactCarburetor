import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/**
 * A detached copy of plain data.
 *
 * Only plain objects and arrays are copied — the same boundary the tracking proxies use.
 * Anything else (Map, Set, Date, class instances) is carried over by reference, because the
 * engine does not track it field by field either. State is own enumerable string-keyed data:
 * `Object.keys` is what the state model (R6-02/R6-03) says a container's fields are, so it is
 * also what this walks — no symbol keys, no non-enumerable properties to weigh each one against.
 * An own key literally named `__proto__` still needs `Object.defineProperty` to land as a data
 * property instead of reassigning the target's prototype.
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

        if (length <= 4096) {
            for (let index = 0; index < length; index++) {
                if (Object.prototype.hasOwnProperty.call(value, index)) {
                    result[index] = deepClone(value[index]);
                }
            }
        } else {
            for (const key of Object.keys(value)) {
                const index = Number(key);

                if (Number.isInteger(index) && index >= 0 && index < length && String(index) === key) {
                    result[index] = deepClone(value[index]);
                }
            }
        }

        return result as unknown as T;
    }

    const source = value as Record<string, unknown>;
    // Object.create(getPrototypeOf(source)) keeps a null-prototype dictionary null-prototype
    // instead of always landing on Object.prototype the way `{}` would.
    const result: Record<string, unknown> = Object.create(Object.getPrototypeOf(source));
    const keys: string[] = Object.keys(source);

    for (let i = 0; i < keys.length; i++) {
        const key: string = keys[i];
        const cloned: unknown = deepClone(source[key]);

        if (key === '__proto__') {
            Object.defineProperty(result, key, {value: cloned, writable: true, enumerable: true, configurable: true});
        } else {
            result[key] = cloned;
        }
    }

    return result as unknown as T;
};
