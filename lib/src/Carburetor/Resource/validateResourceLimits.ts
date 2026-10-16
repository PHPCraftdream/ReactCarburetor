/** Rejects a malformed `ttl`/`maxEntries` at construction, before either can misbehave.
 *
 * @param ttl - the freshness window to validate; omitted, nothing goes stale
 * @param maxEntries - the entry budget to validate; omitted, unbounded
 */
export const validateResourceLimits = (ttl: number | undefined, maxEntries: number | undefined): void => {
    if (ttl !== undefined && (Number.isNaN(ttl) || ttl < 0)) {
        throw new RangeError('ResourceCarburetor ttl must be a non-negative number');
    }

    if (maxEntries !== undefined && maxEntries !== Infinity
        && (!Number.isInteger(maxEntries) || maxEntries < 0)) {
        throw new RangeError('ResourceCarburetor maxEntries must be a non-negative integer or Infinity');
    }
};
