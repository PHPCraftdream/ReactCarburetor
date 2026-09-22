import { TPath } from "../../Models/Paths.mjs";
/**
 * The key a tracking proxy answers with its own cache handle: an internal introspection hatch
 * the engine's tests read to observe cache ownership deterministically. Not a data key — the
 * get traps answer it before touching the target, so reading it records nothing, creates
 * nothing, and never appears in a path. Internal to the engine; deliberately absent from the
 * package's public surface.
 */
export declare const PROXY_CACHE: unique symbol;
/**
 * The ownership contract of the branch cache: entries are keyed by path within one cache, one
 * cache belongs to one recorder's proxy tree, and an entry survives only while its source is
 * still the live value at its path. Keying by raw object identity alone would hand a wrapper
 * that records under one path and recorder to a reader of another.
 */
export interface IProxyCache {
    /**
     * Answers with the proxy for (path, source), reusing the cached one while the entry is
     * current and creating a fresh one through `create` on a miss or after the old one was
     * evicted.
     *
     * @param path - the full path the branch was read at.
     * @param source - the raw value the branch holds right now.
     * @param create - builds the wrapper on a miss; never called while a current entry stands.
     */
    (path: TPath, source: object, create: () => object): object;
    /**
     * Marks `path` — and every cached path below it — obsolete: current entries there are
     * dropped the next time anything consults this cache. Publishing is separate from
     * sweeping, so a write costs one revision bump and one map entry, and the sweep is paid
     * by the next reader instead of the writer.
     *
     * @param path - the written path whose old subtree is no longer the live data.
     */
    invalidate: (path: TPath) => void;
    /**
     * Whether the cache currently holds an entry for (path, source). Reports the state as it
     * is — it does NOT sweep first — so a test that wants to observe the engine's own eviction
     * must consult the cache through the proxy (any path) before asking.
     *
     * @param path - the path to look up.
     * @param source - the raw object the entry would have to be holding.
     */
    owns: (path: TPath, source: object) => boolean;
    /**
     * How many entries the cache holds right now, without sweeping: the deterministic
     * ownership count the tests assert on.
     */
    size: () => number;
}
/**
 * Cache of proxies for nested branches, with explicit ownership of obsolete targets: the map holds a branch's
 * source and wrapper only while the branch is still the live value at its path. It also remembers the source object:
 * if the value behind a path has been replaced, the proxy over the old object is no longer valid and gets recreated.
 *
 * When a write replaces or deletes a branch, or reorders an array, the write proxy publishes
 * the written path to the invalidation scope shared by every proxy over the same raw object;
 * each cache over that object sweeps the obsolete entries the next time anything consults it.
 * A read at another path is enough to release a deleted branch — no read at the old path is
 * required, and no garbage-collection timing is involved. Entries minted after an invalidation
 * carry the newer revision and survive the sweep: re-reading the written path files a fresh,
 * valid entry.
 *
 * Sweeping is lazy by design: the cost lands on the next reader rather than the writer, and
 * the tests pin the resulting ownership down deterministically through `owns`/`size`.
 *
 * @param target - the raw object the proxies asking for this cache front; scopes are shared
 * per raw object, so a read proxy and the write proxies over the same data observe the same
 * invalidations.
 */
export declare const createProxyCache: (target: object) => IProxyCache;
