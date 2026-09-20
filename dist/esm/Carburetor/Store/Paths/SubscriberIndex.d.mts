import { TPath, TPathSet } from "../../Models/Paths.mjs";
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
    protected exact: Map<TPath, Set<string>>;
    protected branch: Map<TPath, Set<string>>;
    protected wildcard: Set<string>;
    protected readsById: Map<string, TPathSet>;
    add: (id: string, reads: TPathSet) => void;
    remove: (id: string) => void;
    match: (writes: TPathSet) => Set<string>;
    protected eachAncestor: (path: TPath, visit: (ancestor: TPath) => void) => void;
    protected register: (target: Map<TPath, Set<string>>, path: TPath, id: string) => void;
    protected unregister: (target: Map<TPath, Set<string>>, path: TPath, id: string) => void;
    protected collect: (source: Set<string> | undefined, target: Set<string>) => void;
}
