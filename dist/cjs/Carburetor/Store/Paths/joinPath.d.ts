import { TPath } from "../../Models/Paths.js";
/**
 * Appends a key to a path; the root's empty base produces the key alone.
 *
 * @param basePath - the path built so far, used verbatim: a non-empty one is joined by
 * the separator before the key.
 * @param key - the segment to add, escaped in place so a separator inside it cannot
 * fake a nesting level.
 *
 * The key is escaped JSON-Pointer style — `~` to `~0`, then the separator to `~1`, in that
 * order, the same escape encodeCacheKey uses — so a key that contains the separator stays one
 * segment: a real `a.b` records as `a~1b` and can no longer be mistaken for `b` under `a`.
 * Matching only ever compares whole paths and separator prefixes (SubscriberIndex,
 * pathsIntersect), so the escape needs no inverse.
 */
export declare const joinPath: (basePath: TPath, key: string) => TPath;
