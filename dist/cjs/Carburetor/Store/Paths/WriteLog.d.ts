import { TPath, TPathSet } from "../../Models/Paths.js";
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
export declare class WriteLog {
    /** How many entries `last` and `under` may hold together before the log resets. */
    private readonly capacity;
    /** The version each written path was last written at. */
    private readonly last;
    /** The version of the latest write strictly below each path. */
    private readonly under;
    /** The version of the latest wildcard write. */
    private wildcardVersion;
    /** A baseline below this predates what the log still knows and must fall back. */
    private watermark;
    /**
     * Sets the log's bound.
     *
     * @param capacity - how many distinct paths, ancestors included, to index before resetting.
     */
    constructor(capacity?: number);
    /**
     * Indexes one emit's touched paths and their ancestors under `version`.
     *
     * @param version - the version this emit bumped to, already incremented by the caller
     * @param writes - the paths this emit published
     */
    record(version: number, writes: TPathSet): void;
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
    matches(baselineVersion: number, reads: ReadonlySet<TPath>): boolean;
}
