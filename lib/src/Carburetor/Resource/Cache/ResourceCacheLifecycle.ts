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
import {describeError} from "@/Carburetor/Resource/describeError";
import {createAbortHandle} from "@/Carburetor/Resource/createAbortHandle";
import {createCacheSupersededError} from "@/Carburetor/Resource/createCacheSupersededError";
import {getInitialCacheEntry} from "./State/getInitialCacheEntry";
import {EvictionLedger} from "./EvictionLedger";
import {buildCacheRestore} from "./State/buildCacheRestore";
import {prepareCacheRequest} from "./State/prepareCacheRequest";
import {removeCacheEntries} from "./State/Mutation/removeCacheEntries";
import {abortCacheKey} from "./State/abortCacheKey";
import {rebindCacheFailures} from "./State/Mutation/rebindCacheFailures";

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
    /** Raw request failures, owned by the current entry at each key. */
    protected failures: Map<string, {value: unknown; error: string; status: EResourceStatus; entry: IResourceEntry<T>}>
        = new Map();
    /** Requests begun against a failed entry, even when its raw rejection is no longer retained. */
    private failedRetries: WeakSet<AbortController> | undefined;
    /** Requests made obsolete by an explicit invalidation while still in flight. */
    private invalidatedRequests: WeakSet<AbortController> | undefined;
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
        this.eviction.reset();

        controllers.forEach(([, controller]: [string, AbortController]) => controller.abort());

        // A nested restore owns publication once it has started.
        if (generation !== this.restoreGeneration) {
            return;
        }
        const ownedReplay = this.patchObservers?.ownRestore(data) === true;
        this.setData(buildCacheRestore(
            data, ownedReplay, this.data, this.controllers.keys(),
            (key) => this.touch(key), (key) => this.eviction.lastUsed.has(key)
        ));
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
        const controller = this.controllers.get(key);
        if (controller) {
            (this.invalidatedRequests ||= new WeakSet<AbortController>()).add(controller);
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
                const controller = this.controllers.get(key);
                if (controller) {
                    (this.invalidatedRequests ||= new WeakSet<AbortController>()).add(controller);
                }
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
        if (this.bulkDepth === 0) {
            super.emitUpdate();
        }
    }

    /**
     * Remove the entry at a resolved cache key.
     *
     * @param key - the resolved cache key to drop
     */
    protected forgetKey(key: string): void {
        this.abortKey(key);

        // An abort listener may have started a newer request for this key.
        if (this.controllers.has(key)) return;

        if (!this.data.entries[key]) {
            this.failures.delete(key);
            this.eviction.lastUsed.delete(key);
            this.viewCache.delete(key);
            return;
        }
        this.removeEntries([key], false);
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

    /**
     * Evict the least recently used unretained entries — see `EvictionLedger` for why this is
     * safe to call on every fetch and every answer without an `Object.keys` count, a filter or
     * a sort over the whole live entry set.
     *
     * @param deferNotification - whether to publish the removal on a microtask instead of now
     */
    protected evict(deferNotification: boolean = false): void {
        if (this.eviction.shouldSkip(this.maxEntries)) return;

        // subscriberIndex answers "is anyone reading at or below this key's path" in O(1), in
        // place of the old scan over every subscriber's whole read set.
        const doomed = this.eviction.selectVictims(this.maxEntries, (key: string): boolean => {
            return this.requests.has(key) || this.subscriberIndex.hasReaderAt(joinPath('entries', key));
        });

        if (doomed.length === 0) return;

        this.removeEntries(doomed, deferNotification);
    }

    /** Delete actual slots before bookkeeping; locked keys require an owned replacement.
     *
     * @param keys - entries to remove.
     * @param deferNotification - schedules publication instead of notifying immediately.
     */
    private removeEntries(keys: string[], deferNotification: boolean): void {
        removeCacheEntries(this.data, keys, deferNotification, {
            replace: (previous, next) => {
                rebindCacheFailures(this.failures, previous, next);
                try {
                    this.setData(next);
                } catch (error) {
                    if (this.data === previous) rebindCacheFailures(this.failures, next, previous);
                    throw error;
                }
            },
            draft: () => this.draft,
            current: () => this.data,
            forgot: (key, replaced) => {
                this.eviction.forget(key, replaced);
                if (!replaced) {
                    this.failures.delete(key);
                    this.viewCache.delete(key);
                }
            },
            publish: (defer) => { if (defer) this.emitSoon(); else this.emitUpdate(); },
        });
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
        abortCacheKey(
            key, this.controllers, this.requests, this.failures, this.failedRetries,
            () => this.data, (change) => this.update(change)
        );
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
            if (this.isStale(entry) && !entry.failed && !this.requests.has(key)) {
                void this.fetch(key, args, true);
            }

            return entry.data as T;
        }

        if (entry && entry.status === EResourceStatus.Error) {
            if (entry.invalidated && !entry.failed) {
                throw this.fetch(key, args, true);
            }

            const failure = this.failures.get(key);
            if (failure && failure.entry !== entry) {
                this.failures.delete(key);
            }
            throw failure?.entry === entry ? failure.value : new Error(entry.error || 'Carburetor: resource failed');
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

        if (known) return known;

        const entry = this.data.entries[key];
        const prepared = prepareCacheRequest(this.data, key, entry);
        const prior = this.data;
        const priorStatus = entry?.status;
        const priorError = entry?.error;
        const priorRefreshing = entry?.refreshing;
        const controller = createAbortHandle();
        let resolveRequest: () => void = () => undefined;
        let rejectRequest: (error: unknown) => void = () => undefined;
        const request = new Promise<void>((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        });

        this.controllers.set(key, controller);
        this.requests.set(key, request);
        if (entry && (entry.status === EResourceStatus.Error || entry.failed || entry.error !== undefined)) {
            (this.failedRetries ||= new WeakSet<AbortController>()).add(controller);
        }
        try {
            this.markLoading(key, deferNotification, entry, prepared);
            if (this.isCurrent(key, controller)) this.evict(deferNotification);
        } catch (error) {
            if (this.controllers.get(key) === controller) {
                this.controllers.delete(key);
                this.requests.delete(key);
                controller.abort();
                if (!this.controllers.has(key)) try {
                    if (prepared && this.data === prior) rebindCacheFailures(this.failures, prepared, prior);
                    if (prepared && this.data === prepared) {
                        rebindCacheFailures(this.failures, prepared, prior);
                        this.setData(prior);
                    } else if (!entry && this.data.entries[key]?.status === EResourceStatus.Pending) {
                        this.removeEntries([key], false);
                    } else if (entry && this.data.entries[key] &&
                        (this.data.entries[key] === entry ||
                            this.data.entries[key].status === EResourceStatus.Pending ||
                            this.data.entries[key].refreshing)) {
                        this.update((draft) => {
                            draft.entries[key].status = priorStatus as EResourceStatus;
                            draft.entries[key].error = priorError;
                            draft.entries[key].refreshing = priorRefreshing as boolean;
                        });
                    }
                } catch {
                    // Preserve the original publication failure; no request remains joinable.
                }
            }
            void request.catch(() => undefined);
            rejectRequest(error);
            throw error;
        }

        if (!this.isCurrent(key, controller)) {
            rejectRequest(createCacheSupersededError());

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

        // Capacity was reconciled before invoking user code; eviction cannot strand its answer.

        return request;
    }

    /** Publish a joinable request with capabilities for eventual settlement.
     *
     * @param key - encoded entry key.
     * @param deferNotification - schedules Pending publication.
     * @param entry - previous answer, if present.
     * @param prepared - detached operational graph for a restrictive entry.
     */
    protected markLoading(
        key: string, deferNotification: boolean, entry: IResourceEntry<T> | undefined,
        prepared?: IResourceCacheData<T>
    ): void {
        if (prepared) {
            rebindCacheFailures(this.failures, this.data, prepared);
            if (deferNotification) this.bulkDepth++;
            try {
                this.setData(prepared);
            } finally {
                if (deferNotification) this.bulkDepth--;
            }
            if (deferNotification) this.emitSoon();
            return;
        }
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
        if (deferNotification) this.emitSoon();
        else this.emitUpdate();
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
            draft.entries[key].invalidated = this.invalidatedRequests?.has(controller) || false;
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
        // Same as settleSuccess: the request ending may be exactly what frees this key.
        if (this.isRetentionFree(key)) {
            this.eviction.release();
        }
        const entry = this.data.entries[key];
        const hasData = entry.status === EResourceStatus.Success || entry.data !== undefined;
        const message = describeError(error);
        this.failures.set(key,
            {value: error, error: message, status: hasData ? entry.status : EResourceStatus.Error, entry});
        this.update((draft: IResourceCacheData<T>) => {
            draft.entries[key].error = message;
            draft.entries[key].refreshing = false;
            draft.entries[key].failed = !this.invalidatedRequests?.has(controller);
            if (!hasData) {
                draft.entries[key].status = EResourceStatus.Error;
            }
        });
        this.evict();
    }
}
