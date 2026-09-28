import { TPath } from "../../Models/Paths.js";
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
 * The ownership contract of the branch cache: one cache belongs to one proxy tree, and an
 * entry survives only while its source is still the live value at its path. Keying by raw
 * object identity alone would hand one path's wrapper to another path reaching the same
 * object; keying by path alone would hand a stale wrapper to a source that replaced it without
 * ever being read at that path again.
 */
export interface IProxyCache {
    /**
     * Answers with the proxy for (path, source): the cached one when `source` is already
     * cached under `path`, a fresh one through `create` otherwise. A path mismatch and a
     * replaced source both mint fresh, unconditionally — there is no separate eviction step.
     *
     * @param path - the full path the branch was read at.
     * @param source - the raw value the branch holds right now.
     * @param create - builds the wrapper on a miss; never called while a current entry stands.
     */
    (path: TPath, source: object, create: () => object): object;
    /**
     * Whether the cache currently holds an entry for (path, source). Test introspection only;
     * production code never calls this.
     *
     * @param path - the path to look up.
     * @param source - the raw object the entry would have to be holding.
     */
    owns: (path: TPath, source: object) => boolean;
}
