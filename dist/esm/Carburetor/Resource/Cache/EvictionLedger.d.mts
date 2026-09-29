/**
 * Entry count, LRU order and eviction hysteresis for a `ResourceCacheLifecycle` (R16-04).
 *
 * Before this existed, `evict()` ran `Object.keys(data.entries)` just to count, then — past
 * the bound — filtered and sorted the whole live set, on every fetch and every answer. A list
 * where each row reads its own entry retains everything, so that ran to completion and found
 * nothing to evict every single time: O(N) per load and O(N) per answer, O(N^2) overall — 8.1 s
 * to settle 4000 rows at the default `maxEntries` (docs/js-review-round-16-2026-09-28.md).
 *
 * `count` answers "is there anything to do" in O(1). Past the bound, `selectVictims` walks
 * `lastUsed` — kept in least-recently-used order by `touch()` re-inserting on every access —
 * from the oldest entry and stops the moment it has enough victims.
 *
 * A scan that comes up short (every remaining candidate retained) is not repeated on the next
 * call: `shouldSkip` remembers the count it ran at, and a later call skips the walk unless
 * something has actually changed — a request settling or a subscriber leaving is a real signal
 * the owner can observe directly and reports through `release()`, so a freed candidate gets a
 * scan right away. The growth check inside `shouldSkip` is only the backstop for the one case
 * neither of those covers: an entry that arrives already idle and unread (e.g. from a
 * `restore()`) and is never subsequently requested or read. It doubles the trigger each time a
 * scan comes up empty — the same amortized trick a growing array's capacity uses — rather than
 * a fixed step: a fixed step still costs O(size^2 / step) once a cache settles into "everything
 * retained" and keeps growing one row at a time, which is the O(N^2) this ledger exists to
 * remove; doubling keeps the total across all those scans proportional to the final size.
 */
export declare class EvictionLedger {
    /** Last access ticks; iteration order is oldest-first (see touch()). */
    readonly lastUsed: Map<string, number>;
    /** Number of live entries the owner is tracking. */
    count: number;
    /** Candidates walked across this ledger's lifetime — a test-readable proof a walk stayed bounded. */
    walks: number;
    /** Monotonic counter behind `touch()`'s ordering. */
    private useTick;
    /** The count at which the last scan found nothing to evict, or undefined if free to scan. */
    private retainedAtCount;
    /**
     * Records an entry access for eviction order: deletes before re-setting so the key moves
     * to the end of the map, making the map's own insertion order the LRU order.
     *
     * @param key - the entry accessed
     */
    touch(key: string): void;
    /** Records that one more entry now exists. */
    create(): void;
    /**
     * Records that an entry is gone, dropping its access record too.
     *
     * @param key - the entry removed
     */
    forget(key: string): void;
    /** Clears everything for a wholesale rebuild; the caller re-touches and re-counts after. */
    reset(): void;
    /** Reconcile a replaced entry set, retaining access order for surviving keys. */
    replace(keys: string[]): void;
    /**
     * Drops the "nothing to evict" memory. Call when a request settles or a subscriber
     * leaves and might have freed a candidate the last scan could not touch.
     */
    release(): void;
    /**
     * Whether `selectVictims` would be a wasted walk right now.
     *
     * @param maxEntries - the owner's configured bound
     */
    shouldSkip(maxEntries: number): boolean;
    /**
     * Walks `lastUsed` oldest-first for up to "count minus maxEntries" unretained keys,
     * stopping as soon as it has enough — no filtering or sorting of the whole entry set.
     *
     * Updates `count` and `lastUsed` for the keys it selects, and remembers the outcome for
     * the next `shouldSkip` call.
     *
     * @param maxEntries - the owner's configured bound
     * @param isRetained - true when a candidate must not be evicted (in flight, or read)
     */
    selectVictims(maxEntries: number, isRetained: (key: string) => boolean): string[];
}
