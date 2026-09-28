import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "./PathSeparator";
import {WILDCARD_PATH} from "./WildcardPath";

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
    protected exact: Map<TPath, Set<string>> = new Map<TPath, Set<string>>();
    /** Ancestor of a read path -> subscribers reading somewhere below it. */
    protected branch: Map<TPath, Set<string>> = new Map<TPath, Set<string>>();
    /** Subscribers that read the wildcard, so every write matches them. */
    protected wildcard: Set<string> = new Set<string>();
    /** Read sets by id, for unregistering and for wildcard writes that match everyone. */
    protected readsById: Map<string, TPathSet> = new Map<string, TPathSet>();
    /** Each read path's ancestor chain, cached per id at add/addPath time and reused by remove. */
    protected ancestorsById: Map<string, Map<TPath, TPath[]>> = new Map<string, Map<TPath, TPath[]>>();

    /**
     * Registers what one subscriber reads, in both maps.
     *
     * @param id - the subscriber's key; re-registering it replaces the old paths.
     * @param reads - the paths to file; the wildcard path routes the id to the wildcard
     * set instead of the maps.
     */
    public add(id: string, reads: TPathSet): void {
        // Re-registering the same id replaces its paths rather than adding a second entry.
        this.remove(id);
        this.readsById.set(id, reads);

        const ancestors = new Map<TPath, TPath[]>();

        this.ancestorsById.set(id, ancestors);

        reads.forEach((readPath: TPath) => {
            if (readPath === WILDCARD_PATH) {
                this.wildcard.add(id);

                return;
            }

            this.file(id, readPath, ancestors);
        });
    }

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

        const exactReaders = this.exact.get(path);

        if (exactReaders && exactReaders.has(id)) {
            return;
        }

        let ancestors = this.ancestorsById.get(id);

        if (!ancestors) {
            ancestors = new Map<TPath, TPath[]>();
            this.ancestorsById.set(id, ancestors);
        }

        this.file(id, path, ancestors);
    }

    /** Forgets a subscriber, dropping every entry its read paths created. */
    public remove(id: string): void {
        const reads = this.readsById.get(id);

        if (!reads) {
            return;
        }

        const ancestors = this.ancestorsById.get(id);

        this.readsById.delete(id);
        this.ancestorsById.delete(id);
        this.wildcard.delete(id);

        reads.forEach((readPath: TPath) => {
            this.unregister(this.exact, readPath, id);

            // The common path reuses what add/addPath already computed; a path that somehow
            // reached `reads` without going through either (there is no such caller today)
            // falls back to recomputing, so unregistering stays correct either way.
            const chain = ancestors?.get(readPath) || this.ancestorsOf(readPath);

            chain.forEach((ancestor: TPath) => this.unregister(this.branch, ancestor, id));
        });
    }

    /** The subscribers a set of written paths concerns: three lookups per write, no scan. */
    public match(writes: TPathSet): Set<string> {
        if (writes.has(WILDCARD_PATH)) {
            return new Set<string>(this.readsById.keys());
        }

        const matched = new Set<string>(this.wildcard);

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
     * Registers one read path in both maps and caches its ancestor chain under the id, so a
     * later `remove` can drop it from `branch` without slicing the path again.
     *
     * @param id - the subscriber the path belongs to
     * @param path - the read path to file
     * @param ancestors - that id's path -> ancestor-chain cache, written into in place
     */
    protected file(id: string, path: TPath, ancestors: Map<TPath, TPath[]>): void {
        this.register(this.exact, path, id);

        const chain = this.ancestorsOf(path);

        ancestors.set(path, chain);
        chain.forEach((ancestor: TPath) => this.register(this.branch, ancestor, id));
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
     * Adds an id to one map's entry for a path, creating the entry when it is the first.
     *
     * @param target - the map to file into: exact or branch, depending on the caller.
     * @param path - the key whose bucket the id joins.
     * @param id - the subscriber to add; repeats are harmless, buckets are sets.
     */
    protected register(target: Map<TPath, Set<string>>, path: TPath, id: string): void {
        const known = target.get(path);

        if (known) {
            known.add(id);

            return;
        }

        target.set(path, new Set<string>([id]));
    }

    /**
     * Removes an id, and the entry itself once it holds nobody: the maps stay bounded.
     *
     * @param target - the map to prune: exact or branch, matching where it was filled.
     * @param path - the bucket to drop the id from; a missing bucket is left alone.
     * @param id - the subscriber leaving; when its bucket empties, the key goes too.
     */
    protected unregister(target: Map<TPath, Set<string>>, path: TPath, id: string): void {
        const known = target.get(path);

        if (!known) {
            return;
        }

        known.delete(id);

        if (known.size === 0) {
            target.delete(path);
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
    protected collect(source: Set<string> | undefined, target: Set<string>): void {
        if (!source) {
            return;
        }

        source.forEach((id: string) => target.add(id));
    }
}
