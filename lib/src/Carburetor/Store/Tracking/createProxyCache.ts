import {TPath} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "@/Carburetor/Store/Paths/PathSeparator";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";

/**
 * The key a tracking proxy answers with its own cache handle: an internal introspection hatch
 * the engine's tests read to observe cache ownership deterministically. Not a data key — the
 * get traps answer it before touching the target, so reading it records nothing, creates
 * nothing, and never appears in a path. Internal to the engine; deliberately absent from the
 * package's public surface.
 */
export const PROXY_CACHE: unique symbol = Symbol('carburetor.proxyCache');

interface IProxyCacheEntry {
    source: object;
    proxy: object;
    /** The invalidation revision this entry was minted at; a write at its path after that evicts it. */
    revision: number;
}

/**
 * The invalidation record every proxy over one raw object shares: write proxies publish written
 * paths here, and each cache drops the entries those writes made obsolete the next time it is
 * consulted. Held per raw object in `scopes`, so the record lives exactly as long as the data
 * it describes and never outlives it.
 */
interface IInvalidationScope {
    /** Bumped by every invalidation: caches compare it against their last sweep to notice new ones. */
    revision: number;
    /** The revision at which each written path — and everything below it — became obsolete. */
    invalidations: Map<TPath, number>;
}

/** The invalidation scopes, keyed by the raw object the proxies front. */
const scopes: WeakMap<object, IInvalidationScope> = new WeakMap();

/**
 * Whether an invalidated path takes a cache key with it: the key is the path itself or a
 * descendant of it. The wildcard and the empty root path take everything.
 */
const covers = (invalidated: TPath, key: TPath): boolean => {
    if (invalidated === WILDCARD_PATH || invalidated === '') {
        return true;
    }

    return key === invalidated || key.startsWith(invalidated + PATH_SEPARATOR);
};

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
export const createProxyCache = (target: object): IProxyCache => {
    const scope: IInvalidationScope = scopes.get(target) ?? {
        revision: 0,
        invalidations: new Map<TPath, number>(),
    };

    scopes.set(target, scope);

    const entries: Map<TPath, IProxyCacheEntry> = new Map<TPath, IProxyCacheEntry>();
    let syncedAt: number = scope.revision;

    /** Drops every entry a published invalidation has made obsolete since the last sweep. */
    const sync = (): void => {
        if (syncedAt === scope.revision) {
            return;
        }

        for (const [path, entry] of entries) {
            for (const [invalidated, revision] of scope.invalidations) {
                if (revision > entry.revision && covers(invalidated, path)) {
                    entries.delete(path);

                    break;
                }
            }
        }

        syncedAt = scope.revision;
    };

    const cache = ((path: TPath, source: object, create: () => object): object => {
        sync();

        const entry = entries.get(path);

        if (entry && entry.source === source) {
            return entry.proxy;
        }

        const proxy = create();
        entries.set(path, {source, proxy, revision: scope.revision});

        return proxy;
    }) as IProxyCache;

    cache.invalidate = (path: TPath): void => {
        scope.revision++;
        scope.invalidations.set(path, scope.revision);
    };

    cache.owns = (path: TPath, source: object): boolean => {
        const entry = entries.get(path);

        return entry !== undefined && entry.source === source;
    };

    cache.size = (): number => entries.size;

    return cache;
};
