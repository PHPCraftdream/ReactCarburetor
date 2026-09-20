import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/**
 * Detached copy of plain data. Only plain objects and arrays are copied — the same
 * boundary the tracking proxies use. Anything else (Map, Set, Date, class instances)
 * is carried over by reference, because the engine does not track it field by field
 * either.
 */
export const deepClone = <T>(value: T): T => {
    if (!isTrackable(value)) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item: unknown) => deepClone(item)) as unknown as T;
    }

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    Object.keys(source).forEach((key: string) => {
        result[key] = deepClone(source[key]);
    });

    return result as unknown as T;
};
