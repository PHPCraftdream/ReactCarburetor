import { IResourceCacheData, IResourceCacheOptions, IResourceEntry, IResourceView, TResourceLoader } from "../../Models/Resource.mjs";
import { Carburetor } from "../../Store/Carburetor.mjs";
/** Owns cache entry lifecycles, request state and eviction. */
export declare abstract class ResourceCacheLifecycle<T, TArgs> extends Carburetor<IResourceCacheData<T>> {
    protected loader: TResourceLoader<T, TArgs>;
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
    /** Raw request failures by cache key. */
    protected failures: Map<string, unknown>;
    /** Last access ticks used for eviction order. */
    protected lastUsed: Map<string, number>;
    /** Monotonic counter for access order. */
    protected useTick: number;
    /** Stable views for unchanged entries. */
    protected viewCache: Map<string, IResourceView<T>>;
    /** Resolve arguments to an entry key. */
    protected abstract keyOf: (args: TArgs) => string;
    /** Configure request lifecycle and cache capacity.
     * @param loader - Function that loads a resource.
     * @param options - Cache and scheduler settings.
     */
    protected constructor(loader: TResourceLoader<T, TArgs>, options?: IResourceCacheOptions);
    /** Restore entries without reviving in-flight requests. */
    restore: (data: IResourceCacheData<T>) => void;
    /** Record an entry access for eviction order. */
    protected touch: (key: string) => void;
    /** Load an entry unless its current value is fresh. */
    load: (args: TArgs) => Promise<void>;
    /** Request an entry even when its current value is fresh. */
    refresh: (args: TArgs) => Promise<void>;
    /** Abort the request for one argument set. */
    abort: (args: TArgs) => void;
    /** Abort all in-flight requests. */
    abortAll: () => void;
    /** Mark an entry stale without removing its data. */
    invalidate: (args: TArgs) => void;
    /** Mark every entry stale. */
    invalidateAll: () => void;
    /** Remove an entry and cancel its request. */
    forget: (args: TArgs) => void;
    /** Remove all entries and cancel their requests. */
    forgetAll: () => void;
    /** Remove the entry at a resolved cache key. */
    protected forgetKey: (key: string) => void;
    /** Report whether the entry needs a fresh request. */
    protected isStale: (entry: IResourceEntry<T>) => boolean;
    /** Check whether a cached view still reflects its entry.
     * @param view - Previously published view.
     * @param entry - Current stored entry.
     * @param stale - Current freshness verdict.
     */
    protected isViewCurrent: (view: IResourceView<T>, entry: IResourceEntry<T>, stale: boolean) => boolean;
    /** Find entries currently retained by subscribers. */
    protected retainedKeys: () => Set<string>;
    /** Evict the least recently used unretained entries. */
    protected evict: (deferNotification?: boolean) => void;
    /** Abort an entry by its resolved key. */
    protected abortKey: (key: string) => void;
    /** Return a ready value or throw its pending request or failure. */
    suspend: (args: TArgs) => T;
    /** Start or reuse a request for an entry.
     * @param key - Resolved cache key.
     * @param args - Loader arguments.
     * @param deferNotification - Whether to defer the update notification.
     */
    protected fetch: (key: string, args: TArgs, deferNotification?: boolean) => Promise<void>;
    /** Publish the loading state of an entry.
     * @param key - Resolved cache key.
     * @param deferNotification - Whether to defer the update notification.
     */
    protected markLoading: (key: string, deferNotification: boolean) => void;
    /** Check that a request still owns the entry.
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     */
    protected isCurrent: (key: string, controller: AbortController) => boolean;
    /** Store the value returned by a current request.
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     * @param data - Loaded resource value.
     */
    protected settleSuccess: (key: string, controller: AbortController, data: T) => void;
    /** Store the failure returned by a current request.
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     * @param error - Raw request failure.
     */
    protected settleFailure: (key: string, controller: AbortController, error: unknown) => void;
}
