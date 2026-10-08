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
 *
 * Raw-target proofs use independent publication and accumulated cardinality bounds (R39-01).
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
    /** Accumulated raw ownership proof. */
    private readonly targets = new AccumulatedWriteTargets();
    /** Bounded latest-write enumeration index. */
    private readonly recent = new RecentWritePaths();
    /** A baseline below this predates what the log still knows and must fall back. */
    private watermark = 0;
    /** The version raw-target and recent-path tracking started at; Infinity until a consumer asks. */
    private trackedSince: number;

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
     * @param tracking - keep the patch proofs from the start; a store passes false and tracks on demand
     */
    constructor(capacity: number = DEFAULT_CAPACITY, tracking: boolean = true) {
        this.capacity = capacity;
        this.trackedSince = tracking ? 0 : Infinity;
    }

    /**
     * Starts retaining the proofs a selection patch needs (R39-04): until a consumer asks, a write
     * pays only for the ordinary path index.
     *
     * @param version - the store version at the request; a baseline below it cannot be answered
     */
    public track(version: number): void {
        if (this.trackedSince === Infinity) this.trackedSince = version;
    }

    /** Returns to the untracked state once no consumer needs proofs (R39-04): releases every retained raw object. */
    public untrack(): void {
        this.trackedSince = Infinity;
        this.targets.reset(0);
        this.recent.clear();
    }

    /**
     * Indexes one emit's touched paths and their ancestors under `version`.
     *
     * @param version - the version this emit bumped to, already incremented by the caller
     * @param writes - the paths this emit published
     * @param targets - the raw objects each written path mutated, when the write proxy knew them
     * @param targetsIncomplete - whether the publication dropped targets to its budget
     */
    public record(
        version: number, writes: TPathSet,
        targets?: ReadonlyMap<TPath, ReadonlySet<object>> | ReadonlyArray<readonly [TPath, object]>,
        targetsIncomplete?: boolean
    ): void {
        const tracking = this.trackedSince !== Infinity;
        if (tracking) this.targets.record(version, writes, targets, targetsIncomplete);

        for (const path of writes) {
            if (path === WILDCARD_PATH) {
                this.wildcardVersion = version;

                continue;
            }

            this.last.set(path, version);
            if (tracking) this.recent.record(path, version);

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
                this.targets.reset(version);
                this.recent.clear();

                return;
            }
        }
    }

    /**
     * Enumerates recent unique paths without scanning old path history.
     *
     * @param baselineVersion - the version the caller's snapshot was valid at
     * @returns the paths, or undefined once the log cannot answer (watermark or wildcard past the baseline)
     */
    public pathsSince(baselineVersion: number): ReadonlyArray<TPath> | undefined {
        if (baselineVersion < this.watermark || baselineVersion < this.trackedSince
            || this.wildcardVersion > baselineVersion) return undefined;
        return this.recent.since(baselineVersion);
    }

    /**
     * The raw objects each recently written path mutated, covering every publication since
     * `baselineVersion`.
     *
     * @param baselineVersion - the version the caller's snapshot was valid at
     * @returns count-bounded accumulated targets, or undefined beyond a reset boundary.
     */
    public targetsSince(baselineVersion: number): ReadonlyMap<TPath, ReadonlySet<object>> | undefined {
        if (baselineVersion < this.watermark || baselineVersion < this.trackedSince
            || this.wildcardVersion > baselineVersion) return undefined;
        return this.targets.since(baselineVersion);
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


interface IEntry {path: TPath; version: number; previous?: IEntry; next?: IEntry}

/** Latest writes linked by version; repeated paths reuse their node (R39-01). */
class RecentWritePaths {
    /** One reusable node per written path. */
    private readonly entries = new Map<TPath, IEntry>();
    /** Most recently written node. */
    private tail: IEntry | undefined;

    /** Moves one path to the latest publication.
     *
     * @param path - written path
     * @param version - publication version
     */
    public record(path: TPath, version: number): void {
        const tail = this.tail;
        if (tail !== undefined && tail.path === path) { tail.version = version; return; }
        let entry = this.entries.get(path);
        if (entry === undefined) {
            entry = {path, version};
            this.entries.set(path, entry);
        } else {
            if (entry.previous) entry.previous.next = entry.next;
            if (entry.next) entry.next.previous = entry.previous;
            if (this.tail === entry) this.tail = entry.previous;
        }
        entry.version = version;
        entry.previous = this.tail;
        entry.next = undefined;
        if (this.tail) this.tail.next = entry;
        this.tail = entry;
    }

    /** Enumerates only recent nodes in last-write order.
     *
     * @param baseline - snapshot version
     * @returns unique recent paths
     */
    public since(baseline: number): TPath[] {
        const recent: TPath[] = [];
        for (let entry = this.tail; entry && entry.version > baseline; entry = entry.previous) recent.push(entry.path);
        return recent.reverse();
    }

    /** Releases all indexed nodes. */
    public clear(): void { this.entries.clear(); this.tail = undefined; }
}


/** Per-publication unique raw pairs one publication may add before the proof is dropped. */
const PUBLICATION_PAIRS = 1024;
/** Accumulated unique raw pairs kept before the proof is dropped. */
const ACCUMULATED_PAIRS = 2048;

/** Whether the pending pairs name every written path, without allocating for small publications. */
const attributesEveryWrite = (writes: TPathSet, pairs: ReadonlyArray<readonly [TPath, object]>): boolean => {
    const size = pairs.length;
    if (size === writes.size && size <= 8) {
        // Distinct pair paths that all belong to `writes` and number as many as it: they are exactly `writes`.
        for (let i = 0; i < size; i++) {
            if (!writes.has(pairs[i][0])) return false;
            for (let j = 0; j < i; j++) if (pairs[j][0] === pairs[i][0]) return false;
        }
        return true;
    }
    const named = new Set<TPath>();
    for (let i = 0; i < size; i++) named.add(pairs[i][0]);
    for (const path of writes) if (!named.has(path)) return false;
    return true;
};

/** Whether one publication touched more unique (path, target) pairs than its budget. */
const exceedsPublicationBudget = (pairs: ReadonlyArray<readonly [TPath, object]>): boolean => {
    const seen = new Map<TPath, Set<object>>();
    let unique = 0;
    for (let i = 0; i < pairs.length; i++) {
        let members = seen.get(pairs[i][0]);
        if (members === undefined) seen.set(pairs[i][0], members = new Set<object>());
        if (!members.has(pairs[i][1])) {
            members.add(pairs[i][1]);
            if (++unique > PUBLICATION_PAIRS) return true;
        }
    }
    return false;
};

/** Count-bounded accumulated attribution with lazy consumer materialization (R39-01/R39-04). */
class AccumulatedWriteTargets {
    /** Retained raw targets per written path since the last reset. */
    private readonly paths = new Map<TPath, Set<object>>();
    /** Retained unique raw-pair cardinality. */
    private count = 0;
    /** Raw proof reset boundary. */
    private watermark = 0;
    /** The pair of the latest single-pair publication, already merged: a repeat of it changes nothing. */
    private lastPath: TPath | undefined;
    /** Raw target of `lastPath`. */
    private lastTarget: object | undefined;

    /** Merges a complete publication; current attribution is checked independently of older targets.
     *
     * @param version - publication version
     * @param writes - published paths
     * @param targets - pending pairs or an attributed map
     * @param incomplete - whether pending recording overflowed
     */
    public record(version: number, writes: TPathSet,
        targets?: ReadonlyMap<TPath, ReadonlySet<object>> | ReadonlyArray<readonly [TPath, object]>,
        incomplete = false): void {
        if (incomplete || targets === undefined || writes.has(WILDCARD_PATH)) { this.reset(version); return; }
        let pairs: ReadonlyArray<readonly [TPath, object]>;
        if (Array.isArray(targets)) {
            pairs = targets as ReadonlyArray<readonly [TPath, object]>;
            if (pairs.length === 1 && writes.size === 1 && pairs[0][0] === this.lastPath
                && pairs[0][1] === this.lastTarget && writes.has(this.lastPath)) return;
        } else {
            const flat: Array<readonly [TPath, object]> = [];
            for (const [path, members] of targets as ReadonlyMap<TPath, ReadonlySet<object>>) {
                for (const target of members) flat.push([path, target]);
            }
            pairs = flat;
        }
        if (pairs.length > PUBLICATION_PAIRS && exceedsPublicationBudget(pairs)) { this.reset(version); return; }
        for (let i = 0; i < pairs.length; i++) {
            let members = this.paths.get(pairs[i][0]);
            if (members === undefined) this.paths.set(pairs[i][0], members = new Set<object>());
            if (!members.has(pairs[i][1])) {
                members.add(pairs[i][1]);
                if (++this.count > ACCUMULATED_PAIRS) { this.reset(version); return; }
            }
        }
        if (!attributesEveryWrite(writes, pairs)) { this.reset(version); return; }
        if (pairs.length === 1 && writes.size === 1) { this.lastPath = pairs[0][0]; this.lastTarget = pairs[0][1]; }
    }

    /** Drops all ownership and materialized references.
     *
     * @param version - reset boundary
     */
    public reset(version: number): void {
        this.paths.clear();
        this.lastPath = this.lastTarget = undefined;
        this.count = 0; this.watermark = version;
    }

    /** The accumulated superset for any baseline past the reset boundary; a live view, read synchronously.
     *
     * @param baseline - snapshot version
     * @returns accumulated targets or unavailable proof
     */
    public since(baseline: number): ReadonlyMap<TPath, ReadonlySet<object>> | undefined {
        return baseline < this.watermark || this.count === 0 ? undefined : this.paths;
    }
}
