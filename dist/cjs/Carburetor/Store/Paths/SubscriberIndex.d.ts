import { TPath, TPathSet } from "../../Models/Paths.js";
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
    protected exact: Map<TPath, Set<string>>;
    /** Ancestor of a read path -> subscribers reading somewhere below it. */
    protected branch: Map<TPath, Set<string>>;
    /** Subscribers that read the wildcard, so every write matches them. */
    protected wildcard: Set<string>;
    /** Read sets by id, for unregistering and for wildcard writes that match everyone. */
    protected readsById: Map<string, TPathSet>;
    /** Each read path's ancestor chain, cached per id at add/addPath time and reused by remove. */
    protected ancestorsById: Map<string, Map<TPath, TPath[]>>;
    /**
     * Registers what one subscriber reads, in both maps.
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
     * Whether the path is already filed is decided by the index's own state, not by
     * whether `reads` already contains it: a caller may share `reads` with something that
     * adds to it directly (a computed's own `dependency.reads`, which `Carburetor.subscribe`
     * adopts without copying — see its comment) before calling here, and a membership check
     * would then read as "already filed" for a path this index has never actually indexed.
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
     * Registers one read path in both maps and caches its ancestor chain under the id, so a
     * later `remove` can drop it from `branch` without slicing the path again.
     *
     * @param id - the subscriber the path belongs to
     * @param path - the read path to file
     * @param ancestors - that id's path -> ancestor-chain cache, written into in place
     */
    protected file(id: string, path: TPath, ancestors: Map<TPath, TPath[]>): void;
    /**
     * A path's ancestors, longest first, stopping before the root segment.
     *
     * @param path - the path to slice up; a single-segment path has no ancestors and
     * returns an empty array.
     */
    protected ancestorsOf(path: TPath): TPath[];
    /**
     * Adds an id to one map's entry for a path, creating the entry when it is the first.
     *
     * @param target - the map to file into: exact or branch, depending on the caller.
     * @param path - the key whose bucket the id joins.
     * @param id - the subscriber to add; repeats are harmless, buckets are sets.
     */
    protected register(target: Map<TPath, Set<string>>, path: TPath, id: string): void;
    /**
     * Removes an id, and the entry itself once it holds nobody: the maps stay bounded.
     *
     * @param target - the map to prune: exact or branch, matching where it was filled.
     * @param path - the bucket to drop the id from; a missing bucket is left alone.
     * @param id - the subscriber leaving; when its bucket empties, the key goes too.
     */
    protected unregister(target: Map<TPath, Set<string>>, path: TPath, id: string): void;
    /**
     * Merges one bucket into the match set, tolerating a bucket that does not exist.
     *
     * @param source - a lookup's bucket, or undefined when no subscriber was filed under
     * the path.
     * @param target - the match set one notifyWrites call is building; ids enter it,
     * never leave it.
     */
    protected collect(source: Set<string> | undefined, target: Set<string>): void;
}
