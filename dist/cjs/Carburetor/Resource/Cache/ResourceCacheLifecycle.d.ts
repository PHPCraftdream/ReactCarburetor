import { EResourceStatus } from "../../Models/Enums/EResourceStatus.js";
import { IResourceCacheData, IResourceCacheOptions, IResourceEntry, IResourceView, TResourceLoader } from "../../Models/Resource.js";
import { TSubscriber } from "../../Models/Base.js";
import { ISubscribeOptions } from "../../Models/Store.js";
import { Carburetor } from "../../Store/Carburetor.js";
import { EvictionLedger } from "./EvictionLedger.js";
/** Owns cache entry lifecycles, request state and eviction. */
export declare abstract class ResourceCacheLifecycle<T, TArgs> extends Carburetor<IResourceCacheData<T>> {
    protected loader: TResourceLoader<T, TArgs>;
    /** Defers publications during nested bulk cancellation or removal. */
    private bulkDepth;
    /** Identifies the latest restore when an abort listener restores again. */
    private restoreGeneration;
    /** Time before a successful entry becomes stale, in milliseconds. */
    protected ttl: number;
    /** Maximum number of unretained entries to keep. */
    protected maxEntries: number;
    /** In-flight requests by cache key. */
    protected requests: Map<string, Promise<void>>;
    /** Abort controllers for in-flight requests. */
    protected controllers: Map<string, AbortController>;
    /** Raw request failures, owned by the current entry at each key. */
    protected failures: Map<string, {
        value: unknown;
        error: string;
        status: EResourceStatus;
        entry: IResourceEntry<T>;
    }>;
    /** Requests begun against a failed entry, even when its raw rejection is no longer retained. */
    private failedRetries;
    /** Requests made obsolete by an explicit invalidation while still in flight. */
    private invalidatedRequests;
    /** Stable views for unchanged entries. */
    protected viewCache: Map<string, IResourceView<T>>;
    /** Entry count, LRU order and eviction hysteresis — see EvictionLedger. */
    protected eviction: EvictionLedger;
    /** Resolve arguments to an entry key. */
    protected abstract keyOf(args: TArgs): string;
    /** Configure request lifecycle and cache capacity.
     *
     * @param loader - Function that loads a resource.
     * @param options - Cache and scheduler settings.
     */
    protected constructor(loader: TResourceLoader<T, TArgs>, options?: IResourceCacheOptions);
    /** Restore entries without reviving in-flight requests. */
    restore(data: IResourceCacheData<T>): void;
    /** Record an entry access for eviction order — see `EvictionLedger.touch`.
     *
     * @param key - the entry accessed
     */
    protected touch(key: string): void;
    /** Registers a subscriber; a reused id with a changed read set may free a candidate
     * `evict()` could not see, so its "nothing to do" memory is dropped rather than trusted.
     *
     * @param callback - see `Carburetor.subscribe`
     * @param options - see `Carburetor.subscribe`
     */
    subscribe(callback: TSubscriber, options?: ISubscribeOptions): string;
    /** Drops a subscriber — a departing reader may free the one entry `evict()` was waiting on.
     *
     * @param id - see `Carburetor.unsubscribe`
     */
    unsubscribe(id: string): void;
    /** Load an entry unless its current value is fresh. */
    load(args: TArgs): Promise<void>;
    /** Request an entry even when its current value is fresh. */
    refresh(args: TArgs): Promise<void>;
    /** Abort the request for one argument set. */
    abort(args: TArgs): void;
    /** Abort all in-flight requests. */
    abortAll(): void;
    /** Mark an entry stale without removing its data. */
    invalidate(args: TArgs): void;
    /** Mark every entry stale. */
    invalidateAll(): void;
    /** Remove an entry and cancel its request. */
    forget(args: TArgs): void;
    /** Remove all entries and cancel their requests. */
    forgetAll(): void;
    /** End bulk scope before delivery so subscriber re-entry publishes separately. */
    private finishBulk;
    /** Publish bulk writes once. */
    protected emitUpdate(): void;
    /**
     * Remove the entry at a resolved cache key.
     *
     * @param key - the resolved cache key to drop
     */
    protected forgetKey(key: string): void;
    /**
     * Report whether the entry needs a fresh request.
     *
     * @param entry - the entry to check
     */
    protected isStale(entry: IResourceEntry<T>): boolean;
    /**
     * Evict the least recently used unretained entries — see `EvictionLedger` for why this is
     * safe to call on every fetch and every answer without an `Object.keys` count, a filter or
     * a sort over the whole live entry set.
     *
     * @param deferNotification - whether to publish the removal on a microtask instead of now
     */
    protected evict(deferNotification?: boolean): void;
    /** Whether a key has neither an in-flight request nor a reader right now.
     *
     * @param key - the entry to check
     */
    protected isRetentionFree(key: string): boolean;
    /**
     * Abort an entry by its resolved key.
     *
     * @param key - the resolved cache key to abort
     */
    protected abortKey(key: string): void;
    /**
     * Return a ready value or throw its pending request or failure.
     *
     * @param args - the loader arguments identifying the entry
     */
    suspend(args: TArgs): T;
    /** Start or reuse a request for an entry.
     *
     * @param key - Resolved cache key.
     * @param args - Loader arguments.
     * @param deferNotification - Whether to defer the update notification.
     */
    protected fetch(key: string, args: TArgs, deferNotification?: boolean): Promise<void>;
    /** Publish the loading state of an entry.
     *
     * @param key - Resolved cache key.
     * @param deferNotification - Whether to defer the update notification.
     * @param entry - Entry observed before the loading transition.
     */
    protected markLoading(key: string, deferNotification: boolean, entry: IResourceEntry<T> | undefined): void;
    /** Check that a request still owns the entry.
     *
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     */
    protected isCurrent(key: string, controller: AbortController): boolean;
    /** Store the value returned by a current request.
     *
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     * @param data - Loaded resource value.
     */
    protected settleSuccess(key: string, controller: AbortController, data: T): void;
    /** Store the failure returned by a current request.
     *
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     * @param error - Raw request failure.
     */
    protected settleFailure(key: string, controller: AbortController, error: unknown): void;
}
