import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "./PathSeparator";
import {WILDCARD_PATH} from "./WildcardPath";

/** How many (version, path) entries the log keeps before the oldest ones age out. */
const DEFAULT_CAPACITY = 4096;

/**
 * A bounded, append-only record of which paths recent emits touched, keyed by the version each
 * write landed at.
 *
 * `Subscriptions.alignSubscription` (R16-05) uses this to tell a write that concerns a
 * component's read set from a write that does not, instead of force-updating on any version
 * change. The log itself never decides correctness: past its watermark it simply cannot answer,
 * and the caller is expected to fall back to today's coarse check — `matches` reports that by
 * returning `true` (treat as changed) rather than throwing or guessing.
 *
 * Backed by two arrays used as a ring buffer: they grow with the first `capacity` entries (a
 * store that is rarely written never pays for the full ring), then an entry is overwritten in
 * place, and the watermark becomes the version of whatever got overwritten, since nothing
 * before it is completely known any more.
 */
export class WriteLog {
    /** How many (version, path) entries the ring holds before the oldest ones age out. */
    private readonly capacity: number;
    /** The version each slot's path was written at, parallel to `paths`. */
    private readonly versions: number[];
    /** The path recorded in each slot, parallel to `versions`. */
    private readonly paths: TPath[];

    /** How many slots hold a real entry; stops growing once the ring first wraps. */
    private size = 0;
    /** The next slot `record` writes into. */
    private cursor = 0;
    /** Versions at or below this are no longer fully represented; a baseline below it must fall back. */
    private watermark = 0;

    /**
     * Sets the ring's bound; the backing arrays start empty.
     *
     * @param capacity - how many (version, path) entries to keep before the oldest age out;
     * a write touching several paths costs several entries, one per path.
     */
    constructor(capacity: number = DEFAULT_CAPACITY) {
        this.capacity = capacity;
        this.versions = [];
        this.paths = [];
    }

    /**
     * Appends one emit's touched paths, aging out the oldest entries once the ring is full.
     *
     * @param version - the version this emit bumped to, already incremented by the caller
     * @param writes - the paths this emit published; a wildcard path is recorded like any other
     * and matched specially by `matches`
     */
    public record(version: number, writes: TPathSet): void {
        for (const path of writes) {
            if (this.size < this.capacity) {
                this.versions.push(version);
                this.paths.push(path);
                this.size++;
                this.cursor = this.size % this.capacity;

                continue;
            }

            const evicted = this.versions[this.cursor];

            if (evicted > this.watermark) {
                this.watermark = evicted;
            }

            this.versions[this.cursor] = version;
            this.paths[this.cursor] = path;
            this.cursor = (this.cursor + 1) % this.capacity;
        }
    }

    /**
     * Whether a write since `baselineVersion` could concern `reads`, mirroring
     * `SubscriberIndex.match`'s three cases: the same path, a written ancestor of a read path,
     * and a written descendant of a read path.
     *
     * Returns `true` — treat as changed — whenever the log cannot answer precisely: the baseline
     * predates the watermark, or a wildcard write landed in range. Correctness never depends on
     * the log being complete; only how many needless re-renders it saves does.
     *
     * @param baselineVersion - the version the caller's read set was captured at
     * @param reads - the paths that read set touched; only ever read, never mutated, so the
     * public `hasDriftSince` can hand this a `ReadonlySet` straight through
     */
    public matches(baselineVersion: number, reads: ReadonlySet<TPath>): boolean {
        if (baselineVersion < this.watermark) {
            return true;
        }

        if (reads.has(WILDCARD_PATH)) {
            // A wildcard read already subscribes to everything; getting here at all means the
            // version moved, so there is something for it to react to.
            return true;
        }

        // Ancestors of the read paths, for "a written ancestor of a read path" — built lazily,
        // once per call, only if a same-path check does not already settle things.
        let readAncestors: Set<TPath> | undefined;

        for (let seen = 0; seen < this.size; seen++) {
            const index = (this.cursor - 1 - seen + this.capacity * 2) % this.capacity;
            const version = this.versions[index];

            if (version <= baselineVersion) {
                // Entries are appended in non-decreasing version order; walking newest-first
                // means every entry after this one is even older, so nothing later can match.
                break;
            }

            const path = this.paths[index];

            if (path === WILDCARD_PATH || reads.has(path)) {
                return true;
            }

            if (readAncestors === undefined) {
                readAncestors = ancestorsOfAll(reads);
            }

            if (readAncestors.has(path) || hasAncestorIn(path, reads)) {
                return true;
            }
        }

        return false;
    }
}

/**
 * Whether some read in `reads` is an ancestor of `path` — the "written descendant of a read
 * path" case: walks `path`'s own ancestor chain rather than every read's, since only `path`
 * changes per iteration.
 *
 * @param path - the written path being checked
 * @param reads - the read set to check it against
 */
const hasAncestorIn = (path: TPath, reads: ReadonlySet<TPath>): boolean => {
    let cut = path.lastIndexOf(PATH_SEPARATOR);

    while (cut > 0) {
        const ancestor = path.slice(0, cut);

        if (reads.has(ancestor)) {
            return true;
        }

        cut = ancestor.lastIndexOf(PATH_SEPARATOR);
    }

    return false;
};

/** The union of every ancestor of every path in `reads`, for the "written ancestor" case. */
const ancestorsOfAll = (reads: ReadonlySet<TPath>): Set<TPath> => {
    const ancestors = new Set<TPath>();

    reads.forEach((path: TPath) => {
        let cut = path.lastIndexOf(PATH_SEPARATOR);

        while (cut > 0) {
            const ancestor = path.slice(0, cut);

            ancestors.add(ancestor);
            cut = ancestor.lastIndexOf(PATH_SEPARATOR);
        }
    });

    return ancestors;
};
