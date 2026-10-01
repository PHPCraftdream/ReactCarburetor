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
export class EvictionLedger {
    /** Last access ticks; iteration order is oldest-first (see touch()). */
    public readonly lastUsed: Map<string, number> = new Map<string, number>();
    /** Number of live entries the owner is tracking. */
    public count: number = 0;
    /** Candidates walked across this ledger's lifetime — a test-readable proof a walk stayed bounded. */
    public walks: number = 0;
    /** Monotonic counter behind `touch()`'s ordering. */
    private useTick: number = 0;
    /** The count at which the last scan found nothing to evict, or undefined if free to scan. */
    private retainedAtCount: number | undefined = undefined;

    /**
     * Records an entry access for eviction order: deletes before re-setting so the key moves
     * to the end of the map, making the map's own insertion order the LRU order.
     *
     * @param key - the entry accessed
     */
    public touch(key: string): void {
        this.useTick += 1;
        this.lastUsed.delete(key);
        this.lastUsed.set(key, this.useTick);
    }

    /** Records that one more entry now exists. */
    public create(): void {
        this.count += 1;
    }

    /**
     * Commit one actual removal. A reentrant replacement keeps its newer access record.
     *
     * @param key - the entry removed
     * @param replaced - whether a newer entry now owns the same key
     */
    public forget(key: string, replaced = false): void {
        this.count -= 1;
        if (!replaced) this.lastUsed.delete(key);
    }

    /** Clears everything for a wholesale rebuild; the caller re-touches and re-counts after. */
    public reset(): void {
        this.lastUsed.clear();
        this.count = 0;
        this.retainedAtCount = undefined;
    }

    /** Reconcile a replaced entry set, retaining access order for surviving keys. */
    public replace(keys: string[]): void {
        const live = new Set(keys);

        for (const key of this.lastUsed.keys()) {
            if (!live.has(key)) {
                this.lastUsed.delete(key);
            }
        }

        keys.forEach((key: string) => {
            if (!this.lastUsed.has(key)) {
                this.touch(key);
            }
        });

        this.count = keys.length;
        this.retainedAtCount = undefined;
    }

    /**
     * Drops the "nothing to evict" memory. Call when a request settles or a subscriber
     * leaves and might have freed a candidate the last scan could not touch.
     */
    public release(): void {
        this.retainedAtCount = undefined;
    }

    /**
     * Whether `selectVictims` would be a wasted walk right now.
     *
     * @param maxEntries - the owner's configured bound
     */
    public shouldSkip(maxEntries: number): boolean {
        if (this.count <= maxEntries) {
            return true;
        }

        if (this.retainedAtCount === undefined) {
            return false;
        }

        const growthNeeded = Math.max(maxEntries, this.retainedAtCount);

        return this.count < this.retainedAtCount + growthNeeded;
    }

    /**
     * Selects up to `count - maxEntries` unretained victims without changing the ledger.
     * The owner commits each removal only after its dictionary key is gone.
     * A scan coming up short is remembered by `shouldSkip`.
     *
     * @param maxEntries - the owner's configured bound
     * @param isRetained - true when a candidate must not be evicted (in flight, or read)
     */
    public selectVictims(maxEntries: number, isRetained: (key: string) => boolean): string[] {
        const excess = this.count - maxEntries;
        const doomed: string[] = [];

        for (const key of this.lastUsed.keys()) {
            if (doomed.length >= excess) {
                break;
            }

            this.walks += 1;

            if (isRetained(key)) {
                continue;
            }

            doomed.push(key);
        }

        this.retainedAtCount = doomed.length < excess ? this.count : undefined;

        return doomed;
    }
}
