/**
 * Resolves the writable view of one cache entry across a possible replacement of the whole root.
 *
 * Taken once the entry is known to exist: while the root still holds that very entry, writes go
 * through the writable view that was resolved then. If a reentrant publication replaced the root
 * meanwhile, the entry the caller looked at is gone, and every call resolves the key against the
 * draft again instead of writing into the retired object.
 *
 * @param root - the cache data as it stood when the entry was read.
 * @param draft - the writable view of the cache data.
 * @param key - the entry's cache key.
 * @param entry - the entry the caller read from `root`.
 * @returns a resolver to call before each write.
 */
export const writableEntry = <E extends object>(
    root: {entries: Record<string, E>},
    draft: {entries: Record<string, E>},
    key: string,
    entry: E
): (() => E) => {
    const target = draft.entries[key];

    return (): E => root.entries[key] === entry ? target : draft.entries[key];
};
