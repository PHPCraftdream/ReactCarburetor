import {IDict} from "@/Carburetor/Models/Base";
import {ICarburetorSubscription, IUpdateScheduler} from "@/Carburetor/Models/Store";
import {EResourceStatus} from "./Enums/EResourceStatus";

export interface IResourceData<T> {
    status: EResourceStatus;
    data: T | undefined;
    /** Message only: the resource state has to stay serializable for SSR and devtools. */
    error: string | undefined;
    updatedAt: number | undefined;
}

export type TResourceLoader<T, TArgs> = (args: TArgs, signal: AbortSignal) => Promise<T>;

/** The resource slot as snapshot() hands it out: the state plus the key the answer settled under. */
export interface IResourceSnapshot<T> extends IResourceData<T> {
    /**
     * The key the stored answer settled under, which restore() re-establishes so suspend()
     * serves the restored answer only to the arguments that produced it. undefined when the
     * slot holds no settled answer — idle, pending, or a snapshot written before this field
     * existed. It travels in the snapshot, never in the live state, so the IResourceData
     * contract is unchanged.
     */
    key?: string | undefined;
}

/**
 * One cached answer.
 *
 * `refreshing` is separate from `status` on purpose: an entry that already has data must not fall
 * back to `Pending` while it is being refreshed, because there is nothing to show in place of the
 * data and flashing a spinner over what the user is reading is a regression, not a loading state.
 *
 * Everything here is serializable, so a scope can dehydrate it. Bookkeeping that is not state —
 * when an entry was last used, which request is in flight — lives outside the store.
 */
export interface IResourceEntry<T> extends IResourceData<T> {
    refreshing: boolean;

    /**
     * Set by an explicit `invalidate`, cleared by the next successful answer.
     *
     * Separate from `updatedAt` so invalidating does not have to lie about when the data was
     * obtained: the entry is stale because someone said so, not because it aged.
     */
    invalidated: boolean;

    /**
     * The most recent attempt failed and automatic retries are currently disarmed.
     *
     * Separate from `status` because a refresh that fails keeps `status: Success` — the data on
     * hand is still good — while the component layer must not queue another fetch from that
     * failure's own notification, or a failing loader is retried once per render, forever.
     *
     * Set by any failed attempt. Cleared by a successful answer, and by an explicit
     * `invalidate`/`invalidateAll`: a write the server accepted is a new external event, and the
     * documented contract of an invalidation is that entries being read refetch on the next
     * render, which includes an initial Error entry. A pending retry does not erase the last
     * failure. Aborting a retry restores this guard even if the raw rejection was replaced or
     * the Error entry came from hydration; another explicit invalidation can re-arm it.
     */
    failed: boolean;
}

/** The cache's state: entries under keys produced by `encodeCacheKey`. */
export interface IResourceCacheData<T> {
    entries: IDict<IResourceEntry<T>>;
}

/** An entry as a caller sees it, with the freshness verdict computed at read time. */
export interface IResourceView<T> extends IResourceEntry<T> {
    stale: boolean;
}

export interface IResourceCacheOptions {
    /** Non-negative milliseconds; fractional values and `Infinity` are valid. `Infinity` never goes stale. */
    ttl?: number;

    /** Non-negative integer or `Infinity`; zero keeps only retained entries, `Infinity` disables eviction. */
    maxEntries?: number;
    /** Non-negative safe integer (default 4096); zero disables this memo, and Infinity is rejected. */
    keyCacheSize?: number;
    scheduler?: IUpdateScheduler;
}

/**
 * One argument set resolved to everything a reader needs: the cache key, the path to subscribe
 * to, and the entry's current view. One call, one serialization of `args` (R16-10(4)) — the six
 * member split this replaced existed only so a caller already holding the key (`pathOfKey`,
 * `getEntryByKey`) would not re-serialize `args` to get it, which `resolve` no longer requires
 * anyone to do.
 */
export interface IResourceResolution<T> {
    /** The cache key this argument set resolved to. */
    key: string;
    /** The path a reader should subscribe to for this entry and nothing else. */
    path: string;
    /** The entry's current view, with the freshness verdict computed at resolve time. */
    view: IResourceView<T>;
}

/**
 * What a component needs from a cache, and nothing more.
 *
 * Declared as an interface so `AntiHookComponent` can read a cache without importing one: the
 * component layer depends on this shape, the cache implements it, and neither imports the other.
 */
export interface IResourceSource<T, TArgs> extends ICarburetorSubscription {
    /** Resolves one argument set to its key, read path and current view — see `IResourceResolution`. */
    resolve(args: TArgs): IResourceResolution<T>;
    load(args: TArgs): Promise<void>;
}
