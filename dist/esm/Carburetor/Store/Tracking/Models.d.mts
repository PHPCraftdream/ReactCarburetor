import { TPath } from "../../Models/Paths.mjs";
/**
 * The proxy-cache contract types, grouped because the factory, both proxies and the engine's
 * tests all read them: the `PROXY_CACHE` introspection hatch and the `IProxyCache` interface
 * the cache answers to. `Models.ts` files are the one place a source file may hold several
 * related exports.
 */
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
