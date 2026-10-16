/** A remembered earlier answer; runtime-only, never part of state, snapshot or history (D1). */
interface IMemoryAnswer<T> {
    data: T;
    updatedAt: number;
}

/**
 * The runtime-only answer memory behind `load`/`suspend`: a Map in insertion order is the
 * LRU list, an entry is usable while `now - updatedAt < ttl`, and without a `ttl` nothing
 * goes stale (D4).
 *
 * @param ttl - the freshness window; omitted, answers never go stale
 * @param maxEntries - the entry budget; omitted, unbounded
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
            if (!remembered || !this.isFresh(remembered.updatedAt)) return undefined;
            // Map iteration order is the LRU order: a hit moves the entry to most-recent.
            memory.delete(key);
            memory.set(key, remembered);
            return remembered;
        },
        /** Stores a successful answer, evicting the least-recent entry over budget. */
        remember(key: string, data: T, updatedAt: number): void {
            memory.delete(key);
            memory.set(key, {data, updatedAt});
            if (maxEntries === undefined) return;
            while (memory.size > maxEntries) {
                const oldest = memory.keys().next();
                if (oldest.done) break;
                memory.delete(oldest.value);
            }
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
