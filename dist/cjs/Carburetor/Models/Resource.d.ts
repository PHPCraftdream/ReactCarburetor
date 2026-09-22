import { IDict } from "./Base.js";
import { TPath } from "./Paths.js";
import { ICarburetorSubscription, IUpdateScheduler } from "./Store.js";
import { EResourceStatus } from "./Enums/EResourceStatus.js";
export interface IResourceData<T> {
    status: EResourceStatus;
    data: T | undefined;
    /** Message only: the resource state has to stay serializable for SSR and devtools. */
    error: string | undefined;
    updatedAt: number | undefined;
}
export type TResourceLoader<T, TArgs> = (args: TArgs, signal: AbortSignal) => Promise<T>;
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
     * The most recent settled attempt failed, and nothing has asked to try again since.
     *
     * Separate from `status` because a refresh that fails keeps `status: Success` — the data on
     * hand is still good — while the component layer must not queue another fetch from that
     * failure's own notification, or a failing loader is retried once per render, forever.
     *
     * Set by any failed attempt. Cleared by a successful answer, and by an explicit
     * `invalidate`/`invalidateAll`: a write the server accepted is a new external event, and the
     * documented contract of an invalidation is that entries being read refetch on the next
     * render, which must include an entry whose last attempt failed. A retry left in flight or
     * aborted does not clear it — the flag describes the last settled outcome, so an abandoned
     * retry leaves the entry waiting for an explicit `refresh`/`load`.
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
    /** How long an answer counts as fresh, in milliseconds. `Infinity` never goes stale. */
    ttl?: number;
    /** Upper bound on kept entries; the least recently used go first. */
    maxEntries?: number;
    scheduler?: IUpdateScheduler;
}
/**
 * What a component needs from a cache, and nothing more.
 *
 * Declared as an interface so `AntiHookComponent` can read a cache without importing one: the
 * component layer depends on this shape, the cache implements it, and neither imports the other.
 */
export interface IResourceSource<T, TArgs> extends ICarburetorSubscription {
    /** The read path for one entry, so a component subscribes to that entry and nothing else. */
    pathOf(args: TArgs): TPath;
    getEntry(args: TArgs): IResourceView<T>;
    load(args: TArgs): Promise<void>;
}
