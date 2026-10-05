import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "./PathSeparator";
import {WILDCARD_PATH} from "./WildcardPath";

/**
 * How many distinct paths (written paths plus their ancestors) the log indexes before it forgets
 * everything and raises its watermark: 4000 rows each adding their own key index 4002.
 */
const DEFAULT_CAPACITY = 8192;

/**
 * The version each recently written path, and each ancestor of one, was last written at.
 *
 * `Subscriptions.alignSubscription` (R16-05) uses this to tell a write that concerns a
 * component's read set from a write that does not, instead of force-updating on any version
 * change. The log itself never decides correctness: past its watermark it simply cannot answer,
 * and the caller falls back to the coarse check — `matches` reports that by returning `true`.
 *
 * Indexed by path rather than kept as a list of writes, so a commit costs O(read paths × depth)
 * however many writes landed since its render: a list scanned per commit made N rows that each
 * write on mount O(N²).
 */
export class WriteLog {
    /** How many entries `last` and `under` may hold together before the log resets. */
    private readonly capacity: number;
    /** The version each written path was last written at. */
    private readonly last: Map<TPath, number> = new Map<TPath, number>();
    /** The version of the latest write strictly below each path. */
    private readonly under: Map<TPath, number> = new Map<TPath, number>();
    /** The version of the latest wildcard write. */
    private wildcardVersion = 0;
    /** A baseline below this predates what the log still knows and must fall back. */
    private watermark = 0;

    /**
     * Sets the log's bound.
     *
     * @param capacity - how many distinct paths, ancestors included, to index before resetting.
     */
    constructor(capacity: number = DEFAULT_CAPACITY) {
        this.capacity = capacity;
    }

    /**
     * Indexes one emit's touched paths and their ancestors under `version`.
     *
     * @param version - the version this emit bumped to, already incremented by the caller
     * @param writes - the paths this emit published
     */
    public record(version: number, writes: TPathSet): void {
        for (const path of writes) {
            if (path === WILDCARD_PATH) {
                this.wildcardVersion = version;

                continue;
            }

            this.last.set(path, version);

            let cut = path.lastIndexOf(PATH_SEPARATOR);

            while (cut > 0) {
                this.under.set(path.slice(0, cut), version);
                cut = path.lastIndexOf(PATH_SEPARATOR, cut - 1);
            }

            // Oversized emit: index nothing further. Raising the watermark answers every
            // baseline below it coarsely, exactly like the old index-then-forget, and a
            // wildcard later in this same emit is covered by that watermark too — any
            // baseline it could matter for is already below the watermark.
            if (this.last.size + this.under.size > this.capacity) {
                this.last.clear();
                this.under.clear();
                this.watermark = version;

                return;
            }
        }
    }

    /**
     * Whether a write since `baselineVersion` could concern `reads`, mirroring
     * `SubscriberIndex.match`'s three cases: the same path, a written ancestor of a read path,
     * and a written descendant of a read path.
     *
     * Returns `true` — treat as changed — whenever the log cannot answer precisely: the baseline
     * predates the watermark, or a wildcard write landed since it.
     *
     * @param baselineVersion - the version the caller's read set was captured at
     * @param reads - the paths that read set touched; only read
     */
    public matches(baselineVersion: number, reads: ReadonlySet<TPath>): boolean {
        if (baselineVersion < this.watermark || this.wildcardVersion > baselineVersion) {
            return true;
        }

        if (reads.has(WILDCARD_PATH)) {
            // A wildcard read subscribes to everything, and the caller only asks once the version moved.
            return true;
        }

        for (const path of reads) {
            if ((this.last.get(path) ?? 0) > baselineVersion || (this.under.get(path) ?? 0) > baselineVersion) {
                return true;
            }

            let cut = path.lastIndexOf(PATH_SEPARATOR);

            while (cut > 0) {
                if ((this.last.get(path.slice(0, cut)) ?? 0) > baselineVersion) {
                    return true;
                }

                cut = path.lastIndexOf(PATH_SEPARATOR, cut - 1);
            }
        }

        return false;
    }
}
