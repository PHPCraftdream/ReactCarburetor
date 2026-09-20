import {PATH_SEPARATOR} from "@/Carburetor/Store/Paths/PathSeparator";

/**
 * Turns a cache entry's arguments into a key safe to use as one path segment.
 *
 * Paths here are separated by `.` and matching treats a prefix as an ancestor, so a key that
 * contains the separator makes two unrelated entries relatives: with raw keys, writing the entry for
 * `a.b` wakes a component reading the entry for `a`. That was measured on the built engine before
 * this function existed, and it is the reason the key is escaped rather than stringified.
 *
 * The escape is JSON-Pointer's: `~` becomes `~0`, then the separator becomes `~1`. Order matters —
 * escaping the separator first would make `~1` ambiguous. It is reversible, so a key stays readable
 * in devtools: `{"id":"a~1b"}` is still recognisably the argument that produced it.
 *
 * `undefined` arguments become `null`, so a resource loaded without arguments has one stable key.
 */
export const encodeCacheKey = (args: unknown): string => {
    const serialized = JSON.stringify(args === undefined ? null : args) as string;

    return serialized
        .split('~')
        .join('~0')
        .split(PATH_SEPARATOR)
        .join('~1');
};
