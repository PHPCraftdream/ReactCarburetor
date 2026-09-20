import {TPath, TPathSet} from "../../Models/Paths";
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
    protected exact: Map<TPath, Set<string>> = new Map<TPath, Set<string>>();
    protected branch: Map<TPath, Set<string>> = new Map<TPath, Set<string>>();
    protected wildcard: Set<string> = new Set<string>();
    protected readsById: Map<string, TPathSet> = new Map<string, TPathSet>();

    public add = (id: string, reads: TPathSet): void => {
        // Re-registering the same id replaces its paths rather than adding a second entry.
        this.remove(id);
        this.readsById.set(id, reads);

        reads.forEach((readPath: TPath) => {
            if (readPath === WILDCARD_PATH) {
                this.wildcard.add(id);

                return;
            }

            this.register(this.exact, readPath, id);
            this.eachAncestor(readPath, (ancestor: TPath) => this.register(this.branch, ancestor, id));
        });
    };

    public remove = (id: string): void => {
        const reads = this.readsById.get(id);

        if (!reads) {
            return;
        }

        this.readsById.delete(id);
        this.wildcard.delete(id);

        reads.forEach((readPath: TPath) => {
            this.unregister(this.exact, readPath, id);
            this.eachAncestor(readPath, (ancestor: TPath) => this.unregister(this.branch, ancestor, id));
        });
    };

    public match = (writes: TPathSet): Set<string> => {
        if (writes.has(WILDCARD_PATH)) {
            return new Set<string>(this.readsById.keys());
        }

        const matched = new Set<string>(this.wildcard);

        writes.forEach((writePath: TPath) => {
            this.collect(this.exact.get(writePath), matched);
            this.collect(this.branch.get(writePath), matched);
            this.eachAncestor(writePath, (ancestor: TPath) => this.collect(this.exact.get(ancestor), matched));
        });

        return matched;
    };

    protected eachAncestor = (path: TPath, visit: (ancestor: TPath) => void): void => {
        let cut = path.lastIndexOf(PATH_SEPARATOR);

        while (cut > 0) {
            const ancestor = path.slice(0, cut);

            visit(ancestor);
            cut = ancestor.lastIndexOf(PATH_SEPARATOR);
        }
    };

    protected register = (target: Map<TPath, Set<string>>, path: TPath, id: string): void => {
        const known = target.get(path);

        if (known) {
            known.add(id);

            return;
        }

        target.set(path, new Set<string>([id]));
    };

    protected unregister = (target: Map<TPath, Set<string>>, path: TPath, id: string): void => {
        const known = target.get(path);

        if (!known) {
            return;
        }

        known.delete(id);

        if (known.size === 0) {
            target.delete(path);
        }
    };

    protected collect = (source: Set<string> | undefined, target: Set<string>): void => {
        if (!source) {
            return;
        }

        source.forEach((id: string) => target.add(id));
    };
}
