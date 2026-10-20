type TRecord = Record<string, unknown>;

/** Tests whether a value is a plain object root.
 *
 * @param value - candidate value
 */
const plain = (value: unknown): value is TRecord => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

/** Merges saved data and current defaults, optionally dropping unknown keys.
 *
 * @param saved - persisted value
 * @param current - current wire baseline
 * @param prune - whether unknown populated-object keys are discarded
 * @param live - optional live store state, guarding opaque class/native values
 */
export const mergeSaved = (
    saved: unknown,
    current: unknown,
    prune: boolean,
    live?: unknown
): unknown => {
    if (!plain(saved) || !plain(current) || Object.keys(current).length === 0) return saved;
    const result: TRecord = Object.create(Object.getPrototypeOf(current));
    const own = (target: TRecord, key: string): boolean => Object.prototype.hasOwnProperty.call(target, key);
    const put = (key: string, value: unknown): void => {
        Object.defineProperty(result, key, {value, enumerable: true, configurable: true, writable: true});
    };
    Object.keys(current).forEach(key => put(key, current[key]));
    Object.keys(saved).forEach(key => {
        if (prune && !own(current, key)) return;
        const liveValue = plain(live) && own(live, key) ? live[key] : undefined;
        // Opaque live values (class/native) are restored as saved, never merged into.
        const opaque = liveValue !== null && typeof liveValue === 'object' && !plain(liveValue);
        put(key, opaque ? saved[key] : mergeSaved(saved[key], current[key], prune, liveValue));
    });
    return result;
};
