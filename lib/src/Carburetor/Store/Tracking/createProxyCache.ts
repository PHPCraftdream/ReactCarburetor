import {TPath} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "@/Carburetor/Store/Paths/PathSeparator";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {IProxyCache} from "./Models";

interface IProxyCacheEntry {
    source: object;
    proxy: object;
    /** The invalidation revision this entry was minted at; a write published after that evicts it. */
    revision: number;
}

/**
 * What each cache shares with its scope so record retirement can tell a live cache from a dropped
 * one: the cache holds this state strongly, the scope only weakly, so a dropped view's state is
 * pruned at the next retirement pass and stops holding records back instead of pinning them — or
 * pinning entries — until garbage collection happens to run.
 */
interface ICacheState {
    /** The revision this cache has swept through: records at or below it can never touch it again. */
    syncedAt: number;
    entries: Map<TPath, IProxyCacheEntry>;
}

/** One published write: the value at `path`, and everything below it, became obsolete at `revision`. */
interface IInvalidationRecord {
    path: TPath;
    revision: number;
}

/**
 * The invalidation record every proxy over one raw object shares: write proxies publish written
 * paths here, and each cache drops the entries those writes made obsolete the next time it is
 * consulted — any consult, a primitive read or a key enumeration included. Records are retired
 * once no live cache can need one any more, so the ledger stays proportional to the live caches
 * and their entries instead of growing with the object's lifetime write churn. Held per raw
 * object in `scopes`, so the record lives exactly as long as the data it describes and never
 * outlives it.
 */
interface IInvalidationScope {
    /** Bumped by every invalidation: caches compare it against their last sweep to notice new ones. */
    revision: number;
    /** The published writes, ascending by revision; retired records are dropped from it. */
    records: Array<IInvalidationRecord>;
    /** The caches sharing this scope, weakly: a dropped view must not pin records or entries. */
    watchers: Set<WeakRef<ICacheState>>;
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
 * Whether one cache still needs a record: it holds an entry the record exists to evict. A cache
 * that has already swept through a record holds no such entry — the sweep evicted it, and every
 * entry minted afterwards carries a revision at or after the record's — so for those caches the
 * stamp alone decides, and the per-entry scan here runs only for the laggards.
 */
const needsRecord = (state: ICacheState, record: IInvalidationRecord): boolean => {
    for (const [path, entry] of state.entries) {
        if (entry.revision < record.revision && covers(record.path, path)) {
            return true;
        }
    }

    return false;
};

/**
 * Cache of proxies for nested branches, with explicit ownership of obsolete targets: the map holds a branch's
 * source and wrapper only while the branch is still the live value at its path. It also remembers the source object:
 * if the value behind a path has been replaced, the proxy over the old object is no longer valid and gets recreated.
 *
 * When a write replaces or deletes a branch, or reorders an array, the write proxy publishes
 * the written path to the invalidation scope shared by every proxy over the same raw object;
 * each cache sweeps the obsolete entries the next time anything consults it. A read at another
 * path is enough to release a deleted branch — no read at the old path is required, and no
 * garbage-collection timing is involved. Entries minted after an invalidation carry the newer
 * revision and survive the sweep: re-reading the written path files a fresh, valid entry.
 *
 * Sweeping is lazy by design: the cost lands on the next reader rather than the writer, and
 * the tests pin the resulting ownership down deterministically through `owns`/`size`.
 *
 * The published records are a worklist, not a history: each is retired the moment no live
 * cache needs it — every cache sharing the scope has swept through it, or none of the ones
 * that have not holds an entry it would evict. A long-lived dictionary churning through
 * temporary keys therefore keeps a ledger proportional to its live caches, and a sweep walks
 * pending records only, never the writes of a lifetime.
 *
 * @param target - the raw object the proxies asking for this cache front; scopes are shared
 * per raw object, so a read proxy and the write proxies over the same data observe the same
 * invalidations.
 */
export const createProxyCache = (target: object): IProxyCache => {
    const scope: IInvalidationScope = scopes.get(target) ?? {
        revision: 0,
        records: [],
        watchers: new Set<WeakRef<ICacheState>>(),
    };

    scopes.set(target, scope);

    const state: ICacheState = {syncedAt: scope.revision, entries: new Map<TPath, IProxyCacheEntry>()};
    scope.watchers.add(new WeakRef(state));

    /**
     * Drops the records no live cache needs any more. A record goes once every live cache has
     * swept through it — an applied record has nothing left to evict anywhere — or once none of
     * the caches that have not swept through it holds an entry the record would evict. Dropped
     * views' states are pruned first: a dead WeakRef must not hold records back. With `precise`
     * off — on the write path — only the swept-through floor is trimmed and the per-entry checks
     * wait for the next sweep, so publishing a write stays cheap.
     */
    const retire = (precise: boolean): void => {
        for (const watcher of scope.watchers) {
            if (watcher.deref() === undefined) {
                scope.watchers.delete(watcher);
            }
        }

        let sweptThrough: number = scope.revision;

        for (const watcher of scope.watchers) {
            const watched = watcher.deref();

            if (watched !== undefined && watched.syncedAt < sweptThrough) {
                sweptThrough = watched.syncedAt;
            }
        }

        scope.records = scope.records.filter((record) => {
            if (record.revision <= sweptThrough) {
                return false;
            }

            if (!precise) {
                return true;
            }

            for (const watcher of scope.watchers) {
                const watched = watcher.deref();

                if (watched !== undefined && watched.syncedAt < record.revision && needsRecord(watched, record)) {
                    return true;
                }
            }

            return false;
        });
    };

    /** Applies every record published after this cache's last sweep, then retires what no live cache needs. */
    const sweep = (): void => {
        if (state.syncedAt === scope.revision) {
            return;
        }

        const applied = state.syncedAt;

        state.syncedAt = scope.revision;

        for (const record of scope.records) {
            if (record.revision <= applied) {
                continue;
            }

            for (const [path, entry] of state.entries) {
                if (entry.revision < record.revision && covers(record.path, path)) {
                    state.entries.delete(path);
                }
            }
        }

        retire(true);
    };

    const cache = ((path: TPath, source: object, create: () => object): object => {
        sweep();

        const entry = state.entries.get(path);

        if (entry && entry.source === source) {
            return entry.proxy;
        }

        const proxy = create();
        state.entries.set(path, {source, proxy, revision: scope.revision});

        return proxy;
    }) as IProxyCache;

    cache.invalidate = (path: TPath): void => {
        scope.revision++;
        scope.records.push({path, revision: scope.revision});
        retire(false);
    };

    cache.sweep = sweep;

    cache.owns = (path: TPath, source: object): boolean => {
        const entry = state.entries.get(path);

        return entry !== undefined && entry.source === source;
    };

    cache.size = (): number => state.entries.size;

    cache.pending = (): number => scope.records.length;

    return cache;
};
