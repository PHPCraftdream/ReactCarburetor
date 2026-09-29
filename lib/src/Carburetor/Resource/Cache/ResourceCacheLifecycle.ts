import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {
    IResourceCacheData,
    IResourceCacheOptions,
    IResourceEntry,
    IResourceView,
    TResourceLoader,
} from "@/Carburetor/Models/Resource";
import {TSubscriber} from "@/Carburetor/Models/Base";
import {ISubscribeOptions} from "@/Carburetor/Models/Store";
import {Carburetor} from "@/Carburetor/Store/Carburetor";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";
import {describeError} from "@/Carburetor/Resource/describeError";
import {createAbortHandle} from "@/Carburetor/Resource/createAbortHandle";
import {getInitialCacheEntry} from "./getInitialCacheEntry";
import {EvictionLedger} from "./EvictionLedger";

const DEFAULT_TTL: number = 30_000;
const DEFAULT_MAX_ENTRIES: number = 100;

/** Owns cache entry lifecycles, request state and eviction. */
export abstract class ResourceCacheLifecycle<T, TArgs> extends Carburetor<IResourceCacheData<T>> {
    /** Defers publications during nested bulk cancellation or removal. */
    private bulkDepth: number = 0;
    /** Identifies the latest restore when an abort listener restores again. */
    private restoreGeneration: number = 0;
    /** Time before a successful entry becomes stale, in milliseconds. */
    protected ttl: number;
    /** Maximum number of unretained entries to keep. */
    protected maxEntries: number;
    /** In-flight requests by cache key. */
    protected requests: Map<string, Promise<void>> = new Map<string, Promise<void>>();
    /** Abort controllers for in-flight requests. */
    protected controllers: Map<string, AbortController> = new Map<string, AbortController>();
    /** Raw request failures by cache key. */
    protected failures: Map<string, unknown> = new Map<string, unknown>();
    /** Stable views for unchanged entries. */
    protected viewCache: Map<string, IResourceView<T>> = new Map<string, IResourceView<T>>();
    /** Entry count, LRU order and eviction hysteresis — see EvictionLedger. */
    protected eviction: EvictionLedger = new EvictionLedger();

    /** Resolve arguments to an entry key. */
    protected abstract keyOf(args: TArgs): string;

    /** Configure request lifecycle and cache capacity.
     *
     * @param loader - Function that loads a resource.
     * @param options - Cache and scheduler settings.
     */
    protected constructor(protected loader: TResourceLoader<T, TArgs>, options: IResourceCacheOptions = {}) {
        super({entries: {}}, options.scheduler);

        this.ttl = options.ttl === undefined ? DEFAULT_TTL : options.ttl;
        this.maxEntries = options.maxEntries === undefined ? DEFAULT_MAX_ENTRIES : options.maxEntries;
    }

    /** Restore entries without reviving in-flight requests. */
    public restore(data: IResourceCacheData<T>): void {
        const generation = ++this.restoreGeneration;
        const controllers = Array.from(this.controllers.entries());

        // Old requests must stop being joinable before abort listeners can re-enter.
        this.controllers.clear();
        this.requests.clear();
        this.failures.clear();
        this.viewCache.clear();
        // A replacement invalidates the last eviction scan.
        this.eviction.reset();

        controllers.forEach(([, controller]: [string, AbortController]) => controller.abort());

        // A nested restore owns publication once it has started.
        if (generation !== this.restoreGeneration) {
            return;
        }

        const entries: IResourceCacheData<T>['entries'] = {};

        Object.keys(data.entries).forEach((key: string) => {
            const entry = data.entries[key];

            entries[key] = {
                ...entry,
                refreshing: false,
                status: entry.status === EResourceStatus.Pending ? EResourceStatus.Idle : entry.status,
            };

            // Preserve a re-entrant request's newer touch.
            if (!this.eviction.lastUsed.has(key)) {
                this.touch(key);
            }
        });

        // A synchronous abort listener may have started a new request; keep its live state.
        this.controllers.forEach((_controller: AbortController, key: string) => {
            const entry = this.data.entries[key];

            if (entry) {
                entries[key] = entry;
            }
        });

        this.setData(deepClone({entries}));
    }

    /** Record an entry access for eviction order — see `EvictionLedger.touch`.
     *
     * @param key - the entry accessed
     */
    protected touch(key: string): void {
        this.eviction.touch(key);
    }

    /** Registers a subscriber; a reused id with a changed read set may free a candidate
     * `evict()` could not see, so its "nothing to do" memory is dropped rather than trusted.
     *
     * @param callback - see `Carburetor.subscribe`
     * @param options - see `Carburetor.subscribe`
     */
    public subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        if (options.id !== undefined && Object.prototype.hasOwnProperty.call(this.subscribers, options.id)) {
            this.eviction.release();
        }

        return super.subscribe(callback, options);
    }

    /** Drops a subscriber — a departing reader may free the one entry `evict()` was waiting on.
     *
     * @param id - see `Carburetor.unsubscribe`
     */
    public unsubscribe(id: string): void {
        if (Object.prototype.hasOwnProperty.call(this.subscribers, id)) {
            this.eviction.release();
        }

        super.unsubscribe(id);
    }

    /** Load an entry unless its current value is fresh. */
    public load(args: TArgs): Promise<void> {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];

        this.touch(key);

        if (entry && entry.status === EResourceStatus.Success && !this.isStale(entry)) {
            return Promise.resolve();
        }

        return this.fetch(key, args);
    }

    /** Request an entry even when its current value is fresh. */
    public refresh(args: TArgs): Promise<void> {
        const key = this.keyOf(args);

        this.touch(key);
        return this.fetch(key, args);
    }

    /** Abort the request for one argument set. */
    public abort(args: TArgs): void {
        this.abortKey(this.keyOf(args));
    }

    /** Abort all in-flight requests. */
    public abortAll(): void {
        this.bulkDepth++;
        try {
            Array.from(this.controllers.entries()).forEach(([key, controller]) => {
                if (this.controllers.get(key) === controller) {
                    this.abortKey(key);
                }
            });
        } finally {
            this.finishBulk();
        }
    }

    /** Mark an entry stale without removing its data. */
    public invalidate(args: TArgs): void {
        const key = this.keyOf(args);

        if (!this.data.entries[key]) {
            return;
        }

        this.update((draft: IResourceCacheData<T>) => {
            draft.entries[key].invalidated = true;
            draft.entries[key].failed = false;
        });
    }

    /** Mark every entry stale. */
    public invalidateAll(): void {
        const keys = Object.keys(this.data.entries);

        if (keys.length === 0) {
            return;
        }

        this.update((draft: IResourceCacheData<T>) => {
            keys.forEach((key: string) => {
                draft.entries[key].invalidated = true;
                draft.entries[key].failed = false;
            });
        });
    }

    /** Remove an entry and cancel its request. */
    public forget(args: TArgs): void {
        this.forgetKey(this.keyOf(args));
    }

    /** Remove all entries and cancel their requests. */
    public forgetAll(): void {
        this.bulkDepth++;
        try {
            Object.keys(this.data.entries).forEach((key: string) => this.forgetKey(key));
        } finally {
            this.finishBulk();
        }
    }

    /** End bulk scope before delivery so subscriber re-entry publishes separately. */
    private finishBulk(): void {
        this.bulkDepth--;
        if (this.bulkDepth === 0 && (this.draftTouched || this.writes.size > 0)) {
            super.emitUpdate();
        }
    }

    /** Publish bulk writes once. */
    protected emitUpdate(): void {
        if (this.bulkDepth > 0) {
            return;
        }

        super.emitUpdate();
    }

    /**
     * Remove the entry at a resolved cache key.
     *
     * @param key - the resolved cache key to drop
     */
    protected forgetKey(key: string): void {
        this.abortKey(key);

        // An abort listener may have started a newer request for this key.
        if (this.controllers.has(key)) {
            return;
        }

        this.failures.delete(key);
        this.eviction.lastUsed.delete(key);
        this.viewCache.delete(key);

        if (!this.data.entries[key]) {
            return;
        }

        this.eviction.forget(key);

        this.update((draft: IResourceCacheData<T>) => {
            delete draft.entries[key];
        });
    }

    /**
     * Report whether the entry needs a fresh request.
     *
     * @param entry - the entry to check
     */
    protected isStale(entry: IResourceEntry<T>): boolean {
        if (entry.invalidated || entry.updatedAt === undefined) {
            return true;
        }

        return Date.now() - entry.updatedAt > this.ttl;
    }

    /** Check whether a cached view still reflects its entry.
     *
     * @param view - Previously published view.
     * @param entry - Current stored entry.
     * @param stale - Current freshness verdict.
     */
    protected isViewCurrent(view: IResourceView<T>, entry: IResourceEntry<T>, stale: boolean): boolean {
        return view.stale === stale
            && view.status === entry.status
            && view.data === entry.data
            && view.error === entry.error
            && view.updatedAt === entry.updatedAt
            && view.refreshing === entry.refreshing
            && view.invalidated === entry.invalidated
            && view.failed === entry.failed;
    }

    /**
     * Evict the least recently used unretained entries — see `EvictionLedger` for why this is
     * safe to call on every fetch and every answer without an `Object.keys` count, a filter or
     * a sort over the whole live entry set.
     *
     * @param deferNotification - whether to publish the removal on a microtask instead of now
     */
    protected evict(deferNotification: boolean = false): void {
        if (this.eviction.shouldSkip(this.maxEntries)) {
            return;
        }

        // subscriberIndex answers "is anyone reading at or below this key's path" in O(1), in
        // place of the old scan over every subscriber's whole read set.
        const doomed = this.eviction.selectVictims(this.maxEntries, (key: string): boolean => {
            return this.requests.has(key) || this.subscriberIndex.hasReaderAt(joinPath('entries', key));
        });

        if (doomed.length === 0) {
            return;
        }

        doomed.forEach((key: string) => {
            this.failures.delete(key);
            this.viewCache.delete(key);
        });

        const draft = this.draft;

        doomed.forEach((key: string) => {
            delete draft.entries[key];
        });

        if (deferNotification) {
            if (!this.pendingEmit) {
                this.emitSoon();
            }

            return;
        }

        this.emitUpdate();
    }

    /** Whether a key has neither an in-flight request nor a reader right now.
     *
     * @param key - the entry to check
     */
    protected isRetentionFree(key: string): boolean {
        return !this.requests.has(key) && !this.subscriberIndex.hasReaderAt(joinPath('entries', key));
    }

    /**
     * Abort an entry by its resolved key.
     *
     * @param key - the resolved cache key to abort
     */
    protected abortKey(key: string): void {
        const controller = this.controllers.get(key);

        if (!controller) {
            return;
        }

        if (this.controllers.get(key) === controller) {
            this.controllers.delete(key);
            this.requests.delete(key);
        }

        controller.abort();

        // Abort listeners run synchronously and may already own this key again.
        if (this.controllers.has(key)) {
            return;
        }

        const entry = this.data.entries[key];

        if (entry && entry.status === EResourceStatus.Pending) {
            this.update((draft: IResourceCacheData<T>) => {
                draft.entries[key].status = EResourceStatus.Idle;
            });

            return;
        }

        if (entry && entry.refreshing) {
            this.update((draft: IResourceCacheData<T>) => {
                draft.entries[key].refreshing = false;
            });
        }
    }

    /**
     * Return a ready value or throw its pending request or failure.
     *
     * @param args - the loader arguments identifying the entry
     */
    public suspend(args: TArgs): T {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];

        this.touch(key);

        if (entry && entry.status === EResourceStatus.Success) {
            return entry.data as T;
        }

        if (entry && entry.status === EResourceStatus.Error) {
            throw this.failures.has(key)
                ? this.failures.get(key)
                : new Error(entry.error || 'Carburetor: resource failed');
        }

        const known = this.requests.get(key);

        throw known || this.fetch(key, args, true);
    }

    /** Start or reuse a request for an entry.
     *
     * @param key - Resolved cache key.
     * @param args - Loader arguments.
     * @param deferNotification - Whether to defer the update notification.
     */
    protected fetch(key: string, args: TArgs, deferNotification: boolean = false): Promise<void> {
        const known = this.requests.get(key);

        if (known) {
            return known;
        }

        const controller = createAbortHandle();
        let resolveRequest: () => void = () => undefined;
        let rejectRequest: (error: unknown) => void = () => undefined;
        const request = new Promise<void>((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        });

        this.controllers.set(key, controller);
        this.requests.set(key, request);
        this.markLoading(key, deferNotification);

        // Publication can synchronously abort or replace this key's request.
        if (!this.isCurrent(key, controller)) {
            resolveRequest();

            return request;
        }

        let answer: Promise<T>;

        try {
            answer = this.loader(args, controller.signal);
        } catch (error: unknown) {
            answer = Promise.reject(error);
        }

        void answer.then(
            (data: T) => {
                this.settleSuccess(key, controller, data);
            },
            (error: unknown) => {
                this.settleFailure(key, controller, error);
            }
        ).then(resolveRequest, rejectRequest);

        this.evict(deferNotification);

        return request;
    }

    /** Publish the loading state of an entry.
     *
     * @param key - Resolved cache key.
     * @param deferNotification - Whether to defer the update notification.
     */
    protected markLoading(key: string, deferNotification: boolean): void {
        const entry = this.data.entries[key];
        const draft = this.draft;

        if (!entry) {
            draft.entries[key] = {...getInitialCacheEntry<T>(), status: EResourceStatus.Pending};
            this.eviction.create();
        } else if (entry.status !== EResourceStatus.Success) {
            draft.entries[key].status = EResourceStatus.Pending;
            draft.entries[key].error = undefined;
        } else {
            draft.entries[key].refreshing = true;
        }

        if (deferNotification) {
            this.emitSoon();

            return;
        }

        this.emitUpdate();
    }

    /** Check that a request still owns the entry.
     *
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     */
    protected isCurrent(key: string, controller: AbortController): boolean {
        return this.controllers.get(key) === controller && !controller.signal.aborted;
    }

    /** Store the value returned by a current request.
     *
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     * @param data - Loaded resource value.
     */
    protected settleSuccess(key: string, controller: AbortController, data: T): void {
        if (!this.isCurrent(key, controller)) {
            return;
        }

        if (!this.data.entries[key]) {
            this.controllers.delete(key);
            this.requests.delete(key);
            this.failures.delete(key);
            this.eviction.lastUsed.delete(key);
            this.viewCache.delete(key);

            return;
        }

        this.controllers.delete(key);
        this.requests.delete(key);
        this.failures.delete(key);

        // The request that kept this key retained just ended — worth another look.
        if (this.isRetentionFree(key)) {
            this.eviction.release();
        }

        this.update((draft: IResourceCacheData<T>) => {
            draft.entries[key].status = EResourceStatus.Success;
            draft.entries[key].data = data;
            draft.entries[key].error = undefined;
            draft.entries[key].updatedAt = Date.now();
            draft.entries[key].refreshing = false;
            draft.entries[key].invalidated = false;
            draft.entries[key].failed = false;
        });

        this.evict();
    }

    /** Store the failure returned by a current request.
     *
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     * @param error - Raw request failure.
     */
    protected settleFailure(key: string, controller: AbortController, error: unknown): void {
        if (!this.isCurrent(key, controller)) {
            return;
        }

        if (!this.data.entries[key]) {
            this.controllers.delete(key);
            this.requests.delete(key);
            this.failures.delete(key);
            this.eviction.lastUsed.delete(key);
            this.viewCache.delete(key);

            return;
        }

        this.controllers.delete(key);
        this.requests.delete(key);
        this.failures.set(key, error);

        // Same as settleSuccess: the request ending may be exactly what frees this key.
        if (this.isRetentionFree(key)) {
            this.eviction.release();
        }

        const entry = this.data.entries[key];
        const hasData = entry.status === EResourceStatus.Success || entry.data !== undefined;

        this.update((draft: IResourceCacheData<T>) => {
            draft.entries[key].error = describeError(error);
            draft.entries[key].refreshing = false;
            draft.entries[key].failed = true;

            if (!hasData) {
                draft.entries[key].status = EResourceStatus.Error;
            }
        });

        this.evict();
    }
}
