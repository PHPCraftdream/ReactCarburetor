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
    /**
     * The published writes, keyed by path: a later write to a path already pending replaces that
     * path's record instead of piling up alongside it (R3-06) — the newest record for a path always
     * evicts a superset of what an older one for the same path would, so keeping only the newest
     * loses nothing any cache still needs.
     */
    records: Map<TPath, IInvalidationRecord>;
    /** The caches sharing this scope, weakly: a dropped view must not pin records or entries. */
    watchers: Set<WeakRef<ICacheState>>;
    /** Cumulative count of records a retire pass has examined; test introspection only (R3-06). */
    visitedRecords: number;
}

/** The invalidation scopes, keyed by the raw object the proxies front. */
const scopes: WeakMap<object, IInvalidationScope> = new WeakMap();

/**
 * `WeakRef` is a hard runtime dependency (R3-08, R4-10): every watcher this cache registers is
 * held weakly so a dropped view stops pinning records without an explicit `release()` call. Node
 * states its floor via `engines` in package.json, but this is a browser-facing library too, and a
 * missing browser global would otherwise surface as a bare "WeakRef is not a constructor" from
 * deep inside the first tracked read, naming neither the cause nor a fix.
 */
const WEAK_REF_MISSING_MESSAGE: string =
    'Carburetor: this environment has no global WeakRef, which the proxy cache requires to ' +
    'track live views without pinning obsolete data. WeakRef shipped in Node 14.6+ and in every ' +
    'evergreen browser since 2021 — see https://caniuse.com/mdn-javascript_builtins_weakref for ' +
    'supported browser versions, or run this build only where WeakRef is available.';

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
 * The `createProxyCache` contract plus the engine's own test introspection: `release` drops this
 * cache's watcher slot explicitly, independent of whether the JS engine has collected it yet, and
 * `visitedRecords`/`watcherCount` expose the retirement ledger's scan cost and raw watcher count
 * directly, so a test never has to infer either one from real garbage-collection timing (R3-06,
 * R3-07). Deliberately not part of `IProxyCache` in Models.ts, and not exported: production code
 * never calls these, and the factory below hands one back typed only as the public contract —
 * a test that needs this surface asserts its shape locally, the same way it already reads the
 * `PROXY_CACHE` hatch through a manual cast.
 */
interface IProxyCacheHandle extends IProxyCache {
    /**
     * Drops this cache's watcher from the shared scope right away. A view that knows its own
     * lifecycle (e.g. on unmount/detach) can call this so its slot stops being scanned and stops
     * holding records back, without waiting for a write to trigger retirement or for garbage
     * collection to run at all.
     */
    release: () => void;

    /** How many records a retire pass has examined in total, across this scope's lifetime. */
    visitedRecords: () => number;

    /** How many watcher slots the shared scope currently holds, pruned or not. */
    watcherCount: () => number;
}

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
 * that have not holds an entry it would evict. Repeated writes to the SAME path never grow this
 * worklist either: a new record for a path replaces that path's pending record instead of
 * queuing beside it (R3-06), so an idle view that never re-consults its cache still leaves the
 * ledger proportional to the distinct paths touched, not to how many times each was written.
 *
 * A fresh cache also prunes the watcher set on construction, not only on a write — a read-only
 * run that never writes still gets a retirement pass every time a new view is created (R3-07).
 * That still leans on garbage collection having actually run by then, so a view whose owner
 * knows it is done should call `release()` instead of waiting on either a write or the
 * collector: it drops the watcher slot immediately and unconditionally.
 *
 * A watcher holding zero entries needs no record, by construction: `needsRecord` can only ever
 * answer true for a watcher with at least one entry. Pruning such a watcher from `watchers`
 * therefore loses nothing — it cannot silently strand a stale entry, because it has none — and
 * it drops without waiting for the runtime to actually collect it (R4-07/R4-08). A watcher that
 * later mints its first entry re-adds its own slot at that moment, so protection resumes exactly
 * when it starts having something to protect. This is also why every write's retirement pass now
 * runs the full per-entry check immediately (no more cheap/deferred split): the entries a live
 * scope holds at any moment are already bounded by what is actually cached, so the check's cost
 * tracks that live state instead of the object's lifetime write history.
 *
 * @param target - the raw object the proxies asking for this cache front; scopes are shared
 * per raw object, so a read proxy and the write proxies over the same data observe the same
 * invalidations.
 */
export const createProxyCache = (target: object): IProxyCache => {
    // Checked here, early, on every call rather than once at module load: the check is a single
    // typeof comparison, and a module-load-time throw would crash an import that never actually
    // reads through the store, in an environment that might load this module without ever
    // exercising a tracked read.
    if (typeof WeakRef === 'undefined') {
        throw new Error(WEAK_REF_MISSING_MESSAGE);
    }

    const scope: IInvalidationScope = scopes.get(target) ?? {
        revision: 0,
        records: new Map<TPath, IInvalidationRecord>(),
        watchers: new Set<WeakRef<ICacheState>>(),
        visitedRecords: 0,
    };

    scopes.set(target, scope);

    const state: ICacheState = {syncedAt: scope.revision, entries: new Map<TPath, IProxyCacheEntry>()};
    const watcherRef: WeakRef<ICacheState> = new WeakRef(state);

    /**
     * Drops the records no live cache needs any more, and the watcher slots that can no longer
     * ever need one. A watcher is dropped from `watchers` once it is dead (collected) or holds
     * zero entries — an empty watcher cannot satisfy `needsRecord` for anything, so keeping its
     * slot only inflates the set and the retirement scan without protecting any data (R4-07,
     * R4-08); `cache()` below re-adds a watcher's slot the moment it mints an entry, so this
     * never strands a live cache's data. A record then goes once every remaining live watcher has
     * swept through it, or none of the ones that have not holds an entry it would evict.
     */
    const retire = (): void => {
        for (const watcher of scope.watchers) {
            const watched = watcher.deref();

            if (watched === undefined || watched.entries.size === 0) {
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

        for (const [path, record] of scope.records) {
            scope.visitedRecords++;

            if (record.revision <= sweptThrough) {
                scope.records.delete(path);

                continue;
            }

            let stillNeeded = false;

            for (const watcher of scope.watchers) {
                const watched = watcher.deref();

                if (watched !== undefined && watched.syncedAt < record.revision && needsRecord(watched, record)) {
                    stillNeeded = true;

                    break;
                }
            }

            if (!stillNeeded) {
                scope.records.delete(path);
            }
        }
    };

    // Runs against the PRIOR watchers only — this cache's own slot is added right after, so a
    // brand-new, still-empty watcher is never pruned by its own construction (R4-08).
    retire();

    scope.watchers.add(watcherRef);

    /** Applies every record published after this cache's last sweep, then retires what no live cache needs. */
    const sweep = (): void => {
        if (state.syncedAt === scope.revision) {
            return;
        }

        const applied = state.syncedAt;

        state.syncedAt = scope.revision;

        for (const record of scope.records.values()) {
            if (record.revision <= applied) {
                continue;
            }

            for (const [path, entry] of state.entries) {
                if (entry.revision < record.revision && covers(record.path, path)) {
                    state.entries.delete(path);
                }
            }
        }

        retire();
    };

    const cache = ((path: TPath, source: object, create: () => object): object => {
        sweep();

        const entry = state.entries.get(path);

        if (entry && entry.source === source) {
            return entry.proxy;
        }

        const proxy = create();
        state.entries.set(path, {source, proxy, revision: scope.revision});
        // Re-arms this watcher's protection: it may have been pruned above while it held nothing.
        scope.watchers.add(watcherRef);

        return proxy;
    }) as IProxyCacheHandle;

    cache.invalidate = (path: TPath): void => {
        scope.revision++;
        scope.records.set(path, {path, revision: scope.revision});
        retire();
    };

    cache.sweep = sweep;

    cache.release = (): void => {
        scope.watchers.delete(watcherRef);
        retire();
    };

    cache.owns = (path: TPath, source: object): boolean => {
        const entry = state.entries.get(path);

        return entry !== undefined && entry.source === source;
    };

    cache.size = (): number => state.entries.size;

    cache.pending = (): number => scope.records.size;

    cache.visitedRecords = (): number => scope.visitedRecords;

    cache.watcherCount = (): number => scope.watchers.size;

    return cache;
};
