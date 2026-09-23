/**
 * Turns a cache entry's arguments into a key safe to use as one path segment: the JSON of the
 * arguments, escaped by `escapeCacheKey` (the JSON-Pointer escape, `~` to `~0` and the separator
 * to `~1`, that keeps a key holding `.` or `~` one segment).
 *
 * Measured on the built engine before the escape existed: with raw keys, writing the entry for
 * `a.b` woke a component reading `a`. `undefined` arguments become `null`, so a resource loaded
 * without arguments has one stable key.
 */
export declare const encodeCacheKey: (args: unknown) => string;
