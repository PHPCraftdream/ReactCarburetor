import {TPath} from "@/Carburetor/Models/Paths";

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
export const PROXY_CACHE: unique symbol = Symbol('carburetor.proxyCache');

/**
 * The key an engine view answers with the raw object it fronts: the reverse of `PROXY_CACHE`,
 * consumed by `liveViews.readTarget`/`has` instead of a registry insert per proxy. Shared
 * through `Symbol.for` so two package copies (see sharedSingleton) recognize each other's
 * views. Internal to the engine; the get traps answer it before touching the target, so
 * reading it records nothing, creates nothing, and never appears in a path.
 */
export const RAW_TARGET: unique symbol = Symbol.for('react-carburetor.rawTarget');

/**
 * The ownership contract of the branch cache: one cache belongs to one proxy tree, and an
 * entry survives only while its source is still the live value at its path. Keying by raw
 * object identity alone would hand one path's wrapper to another path reaching the same
 * object; keying by path alone would hand a stale wrapper to a source that replaced it without
 * ever being read at that path again.
 *
 * `get`/`set` are split, not one call taking a `create` thunk, so a hit allocates nothing: a
 * caller on the hot read path only builds the `() => createReadProxy(...)` closure after `get`
 * has already answered undefined.
 */
export interface IProxyCache {
    /** Raw root of a draft tree, if this cache belongs to a write proxy. */
    readonly nativeAliasRoot?: object;
    /**
     * The cached proxy for (path, source), or undefined when `source` is not cached under
     * `path` right now — a path mismatch or a replaced source both read as a miss.
     *
     * @param path - the full path the branch was read at.
     * @param source - the raw value the branch holds right now.
     */
    get: (path: TPath, source: object) => object | undefined;

    /**
     * Files the wrapper built for (path, source) after a miss. Unconditional: there is no
     * separate eviction step, a later `set` for the same source simply replaces the entry.
     *
     * @param path - the full path the branch was read at.
     * @param source - the raw value the branch holds right now.
     * @param proxy - the wrapper `get` will answer with for this (path, source) from now on.
     */
    set: (path: TPath, source: object, proxy: object) => void;

    /**
     * Whether the cache currently holds an entry for (path, source). Test introspection only;
     * production code never calls this.
     *
     * @param path - the path to look up.
     * @param source - the raw object the entry would have to be holding.
     */
    owns: (path: TPath, source: object) => boolean;
}
