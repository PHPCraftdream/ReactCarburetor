import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "./PathSeparator";
import {WILDCARD_PATH} from "./WildcardPath";

/**
 * How many distinct paths (written paths plus their ancestors) the log indexes before it forgets
 * everything and raises its watermark: 4000 rows each adding their own key index 4002.
 */
const DEFAULT_CAPACITY = 8192;

/** Raw mutation targets retained per publication before its raw proof is dropped (R38 round 5). */
const TARGET_CAPACITY = 1024;

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
 *
 * Raw-target proofs are bounded independently of ordinary path history: per-publication
 * cardinality, a two-publication coverage ring and a separate `targetsWatermark`. Raw
 * cardinality overflow or an incomplete publication clears only raw ownership — never the
 * ordinary `last`/`under` history, so large plain batches keep the relative R37 patch cost.
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
    /** Immutable target maps for the latest two publications. */
    private latestTargets: ReadonlyMap<TPath, ReadonlySet<object>> | undefined;
    /** Immutable targets from the immediately preceding publication. */
    private previousTargets: ReadonlyMap<TPath, ReadonlySet<object>> | undefined;
    /** Version represented by latestTargets. */
    private latestTargetsVersion = 0;
    /** Version represented by previousTargets. */
    private previousTargetsVersion = 0;
    /** Lazily shared by consumers spanning both retained publications. */
    private combinedTargets: ReadonlyMap<TPath, ReadonlySet<object>> | undefined;
    /** A baseline below this predates every retained raw-target proof. */
    private targetsWatermark = 0;
    /** A baseline below this predates what the log still knows and must fall back. */
    private watermark = 0;

    /** Current lower bound of versions for which path-level matching is unavailable.
     *
     * @returns The current watermark version.
     */
    public getWatermark(): number {
        return this.watermark;
    }

    /** Version of the most recent wildcard write.
     *
     * @returns The most recent wildcard-write version.
     */
    public getWildcardVersion(): number {
        return this.wildcardVersion;
    }

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
     * Raw-target proofs are bounded independently of ordinary path history. An incomplete
     * publication or a publication without targets clears only raw ownership; cardinality
     * beyond `TARGET_CAPACITY` does the same — ordinary `last`/`under` history and the ordinary
     * watermark are untouched, so `pathsSince` and `matches` keep answering. After a successful
     * merge the publication joins the two-entry coverage ring, keeping the two most recent
     * proofs; a baseline older than both falls back. The ordinary capacity reset inside the
     * writes loop also clears raw ownership, since lost history makes everything conservative.
     *
     * @param version - the version this emit bumped to, already incremented by the caller
     * @param writes - the paths this emit published
     * @param targets - the raw objects each written path mutated, when the write proxy knew them
     * @param targetsIncomplete - whether the publication dropped targets to its budget
     */
    public record(
        version: number, writes: TPathSet,
        targets?: ReadonlyMap<TPath, ReadonlySet<object>>, targetsIncomplete?: boolean
    ): void {
        this.combinedTargets = undefined;
        if (targetsIncomplete === true) {
            // The paths themselves are complete; only the raw proof is unavailable.
            this.resetTargets(version);
        } else if (targets !== undefined) {
            let count = 0;
            for (const set of targets.values()) {
                count += set.size;
                if (count > TARGET_CAPACITY) break;
            }
            if (count > TARGET_CAPACITY) {
                this.resetTargets(version);
            } else {
                this.previousTargets = this.latestTargets;
                this.previousTargetsVersion = this.latestTargetsVersion;
                this.latestTargets = targets;
                this.latestTargetsVersion = version;
            }
        } else {
            this.resetTargets(version);
        }

        for (const path of writes) {
            if (path === WILDCARD_PATH) {
                this.wildcardVersion = version;

                continue;
            }

            // Earlier targets cannot fill a missing current-publication attribution.
            if (this.latestTargets !== undefined && (this.latestTargets.get(path)?.size ?? 0) === 0) {
                this.resetTargets(version);
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
            // baseline it could matter for is already below the watermark. Lost ordinary
            // history makes everything conservative, so raw ownership is cleared too.
            if (this.last.size + this.under.size > this.capacity) {
                this.last.clear();
                this.under.clear();
                this.watermark = version;
                this.resetTargets(version);

                return;
            }
        }
    }

    /** Clears only raw-target ownership; ordinary `last`/`under`/`watermark` are untouched.
     *
     * @param version - the version this raw reset is anchored at.
     */
    private resetTargets(version: number): void {
        this.latestTargets = undefined;
        this.previousTargets = undefined;
        this.combinedTargets = undefined;
        this.targetsWatermark = version;
    }

    /**
     * Enumerates the paths written after a baseline: O(log entries), never O(a selection).
     *
     * @param baselineVersion - the version the caller's snapshot was valid at
     * @returns the paths, or undefined once the log cannot answer (watermark or wildcard past the baseline)
     */
    public pathsSince(baselineVersion: number): ReadonlyArray<TPath> | undefined {
        if (baselineVersion < this.watermark || this.wildcardVersion > baselineVersion) return undefined;
        const paths: TPath[] = [];
        for (const [path, version] of this.last) {
            if (version > baselineVersion) paths.push(path);
        }
        return paths;
    }

    /**
     * The raw objects each recently written path mutated, covering every publication since
     * `baselineVersion`.
     *
     * @param baselineVersion - the version the caller's snapshot was valid at
     * @returns the version-covered targets, or undefined when unavailable: ordinary watermark,
     * raw watermark, a wildcard past the baseline, no retained publications, or a ring too
     * short to cover the baseline.
     */
    public targetsSince(baselineVersion: number): ReadonlyMap<TPath, ReadonlySet<object>> | undefined {
        if (baselineVersion < this.watermark || baselineVersion < this.targetsWatermark
            || this.wildcardVersion > baselineVersion || this.latestTargets === undefined) return undefined;
        if (baselineVersion >= this.latestTargetsVersion - 1) return this.latestTargets;
        if (this.previousTargets !== undefined && baselineVersion >= this.previousTargetsVersion - 1) {
            if (this.combinedTargets === undefined) {
                const merged = new Map<TPath, Set<object>>();
                for (const [path, set] of this.previousTargets) merged.set(path, new Set<object>(set));
                for (const [path, set] of this.latestTargets) {
                    const mergedSet = merged.get(path);
                    if (mergedSet === undefined) merged.set(path, new Set<object>(set));
                    else for (const raw of set) mergedSet.add(raw);
                }
                this.combinedTargets = merged;
            }
            return this.combinedTargets;
        }
        // Three or more publications since the baseline: the retained ring cannot prove them.
        return undefined;
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
