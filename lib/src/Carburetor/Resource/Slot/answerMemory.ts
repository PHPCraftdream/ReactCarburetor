/** A remembered earlier answer; runtime-only, never part of state, snapshot or history (D1). */
interface IMemoryAnswer<T> {
    data: T;
    updatedAt: number;
}

/**
 * The runtime-only answer memory behind `load`/`suspend`: a Map in insertion order is the LRU
 * list, an entry is usable while `now - updatedAt < ttl`, and `Infinity` never goes stale (D4).
 * A stale entry is deleted, not skipped; `remember` sweeps every stale entry before evicting.
 *
 * @param ttl - the freshness window; `Infinity`, answers never go stale
 * @param maxEntries - the entry budget; `Infinity`, unbounded
 */
export const createAnswerMemory = <T>(ttl: number | undefined, maxEntries: number | undefined) => {
    const memory = new Map<string, IMemoryAnswer<T>>();
    return {
        /** Whether an answer at `updatedAt` is still usable without a new request. */
        isFresh(updatedAt: number | undefined): boolean {
            if (ttl === undefined) return true;
            if (updatedAt === undefined) return false;
            return Date.now() - updatedAt < ttl;
        },
        /** The answer for `key` while it is fresh, moved to most-recent. */
        fresh(key: string): IMemoryAnswer<T> | undefined {
            const remembered = memory.get(key);
            if (!remembered) return undefined;
            // An expired entry is dropped, not skipped, so stale answers cannot accumulate.
            if (!this.isFresh(remembered.updatedAt)) {
                memory.delete(key);
                return undefined;
            }
            // Map iteration order is the LRU order: a hit moves the entry to most-recent.
            memory.delete(key);
            memory.set(key, remembered);
            return remembered;
        },
        /** Stores a successful answer, sweeping stale entries, then evicting over budget. */
        remember(key: string, data: T, updatedAt: number): void {
            memory.delete(key);
            memory.set(key, {data, updatedAt});
            // Full sweep: LRU order is not updatedAt order, so scan every entry.
            for (const [staleKey, entry] of memory) {
                if (!this.isFresh(entry.updatedAt)) memory.delete(staleKey);
            }
            if (maxEntries !== undefined && maxEntries !== Infinity) {
                while (memory.size > maxEntries) {
                    const oldest = memory.keys().next();
                    if (oldest.done) break;
                    memory.delete(oldest.value);
                }
            }
        },
        /** How many answers are currently remembered. */
        size(): number {
            return memory.size;
        },
        /** Drops one key: a failed answer for it must not be served from memory again. */
        forget(key: string): void {
            memory.delete(key);
        },
        clear(): void {
            memory.clear();
        },
    };
};
