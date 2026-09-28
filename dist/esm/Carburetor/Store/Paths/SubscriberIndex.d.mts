import { TPath, TPathSet } from "../../Models/Paths.mjs";
/**
 * One bucket's contents: almost every bucket ends up holding exactly one id, so that case is
 * stored as the bare id string instead of a one-element `Set`. A second id promotes it to a
 * `Set`; losing one back down to one id demotes it again.
 */
type TBucket = string | Set<string>;
/**
 * Finds the subscribers a set of written paths concerns, without walking every subscriber.
 *
 * Comparing each write against each subscriber's read paths is fine for one changed path,
 * but a transaction touching hundreds of paths with hundreds of subscribers turns into a
 * frozen frame: measured at 110 ms for 500 paths over 1000 subscribers, and 357 ms when
 * nothing matches (see benchmarks/pathsIntersect.mjs).
 *
 * The index keeps two maps, both filled when a subscriber registers:
 *   exact  — read path -> subscribers that read exactly it;
 *   branch — every ancestor of a read path -> subscribers reading below that ancestor.
 *
 * A write to `w` then needs three lookups instead of a scan: `exact[w]` (read equals write),
 * `branch[w]` (read sits below the write) and `exact[p]` for each ancestor `p` of `w` (read
 * sits above the write). That covers the same three cases as `pathsIntersect`, which the
 * differential test pins down.
 *
 * Measured on the same benchmark: one changed path over 1000 subscribers went from 0.39 ms
 * to 0.0009 ms, and 500 changed paths from 110 ms to 0.47 ms — 234x on the case that used
 * to drop frames.
 */
export declare class SubscriberIndex {
    /** Read path -> subscribers whose read set contains exactly it. */
    protected exact: Map<TPath, TBucket>;
    /** Ancestor of a read path -> subscribers reading somewhere below it. */
    protected branch: Map<TPath, TBucket>;
    /** Subscribers that read the wildcard, so every write matches them. */
    protected wildcard: Set<string>;
    /**
     * Read sets by id, adopted by reference: `addPath` mutates the caller's own Set.
     *
     * Doubles as the record of what is actually filed (minus the wildcard path, tracked
     * separately above): a re-registration diffs the fresh set against whatever this map
     * already holds for the id, instead of keeping a second, owned copy of the same paths
     * next to it (R16-09 — that copy cost 240 of 549 B of bookkeeping per four-path
     * subscriber). The diff is only sound while this map's entry and the caller's set stay
     * distinct objects; see `add`'s own comment for the one case where they do not.
     */
    protected readsById: Map<string, TPathSet>;
    /**
     * Registers what one subscriber reads, in both maps.
     *
     * Re-registering an already-known id diffs against the previously adopted set rather
     * than re-filing everything: paths no longer present are unfiled, paths not yet present
     * are filed, and the rest is left alone — O(read-set size) membership checks plus
     * O(changed paths × depth) index work, instead of O(read-set size × depth) every time.
     *
     * `subscribe` adopts the caller's Set without copying (see its own comment), so a
     * re-registration can hand back the very Set instance this index already holds for the
     * id — `addPath` amending a live dependency by one path (R14-01) does exactly that. Diffing
     * a Set against itself always comes out empty, which is the right answer here: `addPath`
     * keeps `exact`/`branch` in sync with every path it adds, so by the time such a
     * re-registration runs there is nothing left to file. A caller that mutates a Set already
     * handed to the index some other way, then hands that same instance back, is out of
     * contract — the amend API is the only mutation path this index can see coming.
     *
     * @param id - the subscriber's key; re-registering it replaces the old paths.
     * @param reads - the paths to file; the wildcard path routes the id to the wildcard
     * set instead of the maps.
     */
    add(id: string, reads: TPathSet): void;
    /**
     * Files one more path into an id's existing registration, leaving the rest of its
     * read set untouched — same exact/branch/wildcard bookkeeping as `add`, per path.
     *
     * O(path depth) instead of O(read-set size): the incremental sibling `add` lacks,
     * for a dependency amended one leaf read at a time.
     *
     * Whether the path is already filed is decided by `exact` itself, not by whether
     * `reads` already contains it: a caller may share `reads` with something that adds to
     * it directly (a computed's own `dependency.reads`, which `Carburetor.subscribe` adopts
     * without copying — see its comment) before calling here, and a membership check on
     * `reads` would then read as "already filed" for a path this index has never actually
     * indexed.
     *
     * @param id - the subscriber to extend; an id with no registration is left alone
     * @param path - the path to file; already-filed paths are a no-op
     */
    addPath(id: string, path: TPath): void;
    /** Forgets a subscriber, dropping every entry its read paths created. */
    remove(id: string): void;
    /** The subscribers a set of written paths concerns: three lookups per write, no scan. */
    match(writes: TPathSet): Set<string>;
    /**
     * Whether any subscriber reads exactly this path or somewhere below it.
     *
     * O(1): a cache's eviction check used this to ask, per candidate key, whether anyone is
     * still reading it instead of scanning every subscriber's read set.
     *
     * @param path - the path to check, e.g. one cache entry's own path
     */
    hasReaderAt(path: TPath): boolean;
    /**
     * First-time registration for an id with nothing filed yet: every non-wildcard path
     * goes straight to `file`, with no diff to compute.
     *
     * @param id - the subscriber being registered for the first time
     * @param reads - the paths to file
     */
    protected registerFresh(id: string, reads: TPathSet): void;
    /**
     * Whether `id` is already filed under this exact path, decided from `exact` itself —
     * see `addPath`'s own comment for why `reads`'s membership cannot answer this.
     *
     * @param path - the exact path to check
     * @param id - the subscriber to look for in that path's bucket
     */
    protected isFiledAt(path: TPath, id: string): boolean;
    /**
     * Registers one read path in both maps.
     *
     * @param id - the subscriber the path belongs to
     * @param path - the read path to file
     */
    protected file(id: string, path: TPath): void;
    /**
     * Drops one read path from both maps — the inverse of `file`, recomputing the same
     * ancestor chain rather than caching it: with `add` now diffing instead of re-filing
     * everything, this only ever runs for paths that actually left a read set.
     *
     * @param id - the subscriber the path belongs to
     * @param path - the read path to drop
     */
    protected unfile(id: string, path: TPath): void;
    /**
     * A path's ancestors, longest first, stopping before the root segment.
     *
     * @param path - the path to slice up; a single-segment path has no ancestors and
     * returns an empty array.
     */
    protected ancestorsOf(path: TPath): TPath[];
    /**
     * Adds an id to one map's entry for a path, creating the entry when it is the first
     * and promoting a bare id to a `Set` when a second one joins it.
     *
     * @param target - the map to file into: exact or branch, depending on the caller.
     * @param path - the key whose bucket the id joins.
     * @param id - the subscriber to add; repeats are harmless.
     */
    protected register(target: Map<TPath, TBucket>, path: TPath, id: string): void;
    /**
     * Removes an id, demoting a `Set` back to a bare id once only one remains, and
     * dropping the entry itself once it holds nobody: the maps stay bounded.
     *
     * @param target - the map to prune: exact or branch, matching where it was filled.
     * @param path - the bucket to drop the id from; a missing bucket is left alone.
     * @param id - the subscriber leaving; when its bucket empties, the key goes too.
     */
    protected unregister(target: Map<TPath, TBucket>, path: TPath, id: string): void;
    /**
     * Merges one bucket into the match set, tolerating a bucket that does not exist.
     *
     * @param source - a lookup's bucket, or undefined when no subscriber was filed under
     * the path.
     * @param target - the match set one notifyWrites call is building; ids enter it,
     * never leave it.
     */
    protected collect(source: TBucket | undefined, target: Set<string>): void;
}
export {};
