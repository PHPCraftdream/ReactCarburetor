import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "./PathSeparator";
import {WILDCARD_PATH} from "./WildcardPath";

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
export class SubscriberIndex {
    /** Read path -> subscribers whose read set contains exactly it. */
    protected exact: Map<TPath, TBucket> = new Map<TPath, TBucket>();
    /** Ancestor of a read path -> subscribers reading somewhere below it. */
    protected branch: Map<TPath, TBucket> = new Map<TPath, TBucket>();
    /** Subscribers that read the wildcard, so every write matches them. */
    protected wildcard: Set<string> = new Set<string>();
    /** Read sets by id, adopted by reference: `addPath` mutates the caller's own Set. */
    protected readsById: Map<string, TPathSet> = new Map<string, TPathSet>();
    /**
     * The non-wildcard paths this index has actually filed into `exact`/`branch`, by id.
     *
     * Authoritative on its own, independent of whatever `readsById` currently points at:
     * `addPath` mutates that Set in place, so by the time a later `add()` runs for the same
     * id it may be handed back the very same (already-amended) Set instance, with no way to
     * tell old members from new by looking at the Set itself. This record is only ever
     * touched by `file`/`unfile`, so it always reflects what is actually indexed.
     */
    protected filedById: Map<string, Set<TPath>> = new Map<string, Set<TPath>>();

    /**
     * Registers what one subscriber reads, in both maps.
     *
     * Re-registering an already-known id diffs against what is actually filed rather than
     * re-filing everything: paths no longer present are unfiled, paths not yet present are
     * filed, and the rest is left alone — O(read-set size) membership checks plus
     * O(changed paths × depth) index work, instead of O(read-set size × depth) every time.
     *
     * @param id - the subscriber's key; re-registering it replaces the old paths.
     * @param reads - the paths to file; the wildcard path routes the id to the wildcard
     * set instead of the maps.
     */
    public add(id: string, reads: TPathSet): void {
        const filed = this.filedById.get(id);

        this.readsById.set(id, reads);

        if (!filed) {
            this.registerFresh(id, reads);

            return;
        }

        const stale: TPath[] = [];

        filed.forEach((path: TPath) => {
            if (!reads.has(path)) {
                stale.push(path);
            }
        });

        stale.forEach((path: TPath) => {
            this.unfile(id, path);
            filed.delete(path);
        });

        reads.forEach((path: TPath) => {
            if (path === WILDCARD_PATH || filed.has(path)) {
                return;
            }

            this.file(id, path);
            filed.add(path);
        });

        const wantsWildcard = reads.has(WILDCARD_PATH);

        if (wantsWildcard) {
            this.wildcard.add(id);
        } else {
            this.wildcard.delete(id);
        }
    }

    /**
     * Files one more path into an id's existing registration, leaving the rest of its
     * read set untouched — same exact/branch/wildcard bookkeeping as `add`, per path.
     *
     * O(path depth) instead of O(read-set size): the incremental sibling `add` lacks,
     * for a dependency amended one leaf read at a time.
     *
     * Whether the path is already filed is decided by `filedById`, not by whether `reads`
     * already contains it: a caller may share `reads` with something that adds to it
     * directly (a computed's own `dependency.reads`, which `Carburetor.subscribe` adopts
     * without copying — see its comment) before calling here, and a membership check on
     * `reads` would then read as "already filed" for a path this index has never actually
     * indexed.
     *
     * @param id - the subscriber to extend; an id with no registration is left alone
     * @param path - the path to file; already-filed paths are a no-op
     */
    public addPath(id: string, path: TPath): void {
        const reads = this.readsById.get(id);

        if (!reads) {
            return;
        }

        reads.add(path);

        if (path === WILDCARD_PATH) {
            this.wildcard.add(id);

            return;
        }

        const filed = this.filedById.get(id) as Set<TPath>;

        if (filed.has(path)) {
            return;
        }

        this.file(id, path);
        filed.add(path);
    }

    /** Forgets a subscriber, dropping every entry its read paths created. */
    public remove(id: string): void {
        const filed = this.filedById.get(id);

        if (!filed) {
            return;
        }

        this.readsById.delete(id);
        this.filedById.delete(id);
        this.wildcard.delete(id);

        filed.forEach((path: TPath) => this.unfile(id, path));
    }

    /** The subscribers a set of written paths concerns: three lookups per write, no scan. */
    public match(writes: TPathSet): Set<string> {
        if (writes.has(WILDCARD_PATH)) {
            return new Set<string>(this.readsById.keys());
        }

        const matched = this.wildcard.size > 0 ? new Set<string>(this.wildcard) : new Set<string>();

        writes.forEach((writePath: TPath) => {
            this.collect(this.exact.get(writePath), matched);
            this.collect(this.branch.get(writePath), matched);
            this.ancestorsOf(writePath).forEach((ancestor: TPath) => this.collect(this.exact.get(ancestor), matched));
        });

        return matched;
    }

    /**
     * Whether any subscriber reads exactly this path or somewhere below it.
     *
     * O(1): a cache's eviction check used this to ask, per candidate key, whether anyone is
     * still reading it instead of scanning every subscriber's read set.
     *
     * @param path - the path to check, e.g. one cache entry's own path
     */
    public hasReaderAt(path: TPath): boolean {
        return this.exact.has(path) || this.branch.has(path);
    }

    /**
     * First-time registration for an id with nothing filed yet: every non-wildcard path
     * goes straight to `file`, with no diff to compute.
     *
     * @param id - the subscriber being registered for the first time
     * @param reads - the paths to file
     */
    protected registerFresh(id: string, reads: TPathSet): void {
        const filed = new Set<TPath>();

        this.filedById.set(id, filed);

        reads.forEach((path: TPath) => {
            if (path === WILDCARD_PATH) {
                this.wildcard.add(id);

                return;
            }

            this.file(id, path);
            filed.add(path);
        });
    }

    /**
     * Registers one read path in both maps.
     *
     * @param id - the subscriber the path belongs to
     * @param path - the read path to file
     */
    protected file(id: string, path: TPath): void {
        this.register(this.exact, path, id);
        this.ancestorsOf(path).forEach((ancestor: TPath) => this.register(this.branch, ancestor, id));
    }

    /**
     * Drops one read path from both maps — the inverse of `file`, recomputing the same
     * ancestor chain rather than caching it: with `add` now diffing instead of re-filing
     * everything, this only ever runs for paths that actually left a read set.
     *
     * @param id - the subscriber the path belongs to
     * @param path - the read path to drop
     */
    protected unfile(id: string, path: TPath): void {
        this.unregister(this.exact, path, id);
        this.ancestorsOf(path).forEach((ancestor: TPath) => this.unregister(this.branch, ancestor, id));
    }

    /**
     * A path's ancestors, longest first, stopping before the root segment.
     *
     * @param path - the path to slice up; a single-segment path has no ancestors and
     * returns an empty array.
     */
    protected ancestorsOf(path: TPath): TPath[] {
        const chain: TPath[] = [];
        let cut = path.lastIndexOf(PATH_SEPARATOR);

        while (cut > 0) {
            const ancestor = path.slice(0, cut);

            chain.push(ancestor);
            cut = ancestor.lastIndexOf(PATH_SEPARATOR);
        }

        return chain;
    }

    /**
     * Adds an id to one map's entry for a path, creating the entry when it is the first
     * and promoting a bare id to a `Set` when a second one joins it.
     *
     * @param target - the map to file into: exact or branch, depending on the caller.
     * @param path - the key whose bucket the id joins.
     * @param id - the subscriber to add; repeats are harmless.
     */
    protected register(target: Map<TPath, TBucket>, path: TPath, id: string): void {
        const known = target.get(path);

        if (known === undefined) {
            target.set(path, id);

            return;
        }

        if (typeof known === 'string') {
            if (known === id) {
                return;
            }

            target.set(path, new Set<string>([known, id]));

            return;
        }

        known.add(id);
    }

    /**
     * Removes an id, demoting a `Set` back to a bare id once only one remains, and
     * dropping the entry itself once it holds nobody: the maps stay bounded.
     *
     * @param target - the map to prune: exact or branch, matching where it was filled.
     * @param path - the bucket to drop the id from; a missing bucket is left alone.
     * @param id - the subscriber leaving; when its bucket empties, the key goes too.
     */
    protected unregister(target: Map<TPath, TBucket>, path: TPath, id: string): void {
        const known = target.get(path);

        if (known === undefined) {
            return;
        }

        if (typeof known === 'string') {
            if (known === id) {
                target.delete(path);
            }

            return;
        }

        known.delete(id);

        if (known.size === 1) {
            const [remaining] = known;

            target.set(path, remaining);
        }
    }

    /**
     * Merges one bucket into the match set, tolerating a bucket that does not exist.
     *
     * @param source - a lookup's bucket, or undefined when no subscriber was filed under
     * the path.
     * @param target - the match set one notifyWrites call is building; ids enter it,
     * never leave it.
     */
    protected collect(source: TBucket | undefined, target: Set<string>): void {
        if (source === undefined) {
            return;
        }

        if (typeof source === 'string') {
            target.add(source);

            return;
        }

        source.forEach((id: string) => target.add(id));
    }
}
