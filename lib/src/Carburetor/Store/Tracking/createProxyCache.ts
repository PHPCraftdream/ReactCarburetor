import {TPath} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "@/Carburetor/Store/Paths/PathSeparator";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {IProxyCache} from "./Models";

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
