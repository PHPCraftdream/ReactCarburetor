import {R} from "@/Carburetor/Store/Diagnostics/Internal/ResourceSymbols";
import {storeLifecycle} from "@/Carburetor/Store/Diagnostics/Internal/StoreLifecycle";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {
    IResourceCacheData,
    IResourceCacheOptions,
    IResourceEntry,
    TResourceArgs,
    TResourceLoader,
} from "@/Carburetor/Models/Resource";
import {describeError} from "@/Carburetor/Resource/Status/describeError";
import {dropEventArgs} from "@/Carburetor/Resource/Slot/dropEventArgs";
import {createCacheSupersededError} from "@/Carburetor/Resource/Slot/createCacheSupersededError";
import {getInitialCacheEntry} from "./State/getInitialCacheEntry";
import {prepareCacheRequest} from "./State/prepareCacheRequest";
import {ICacheRequest, ICacheRuntime} from "./State/Runtime/Models";
import {ResourceCacheState} from "./State/Runtime/ResourceCacheState";
import {trimCacheRuntime} from "./State/Runtime/Registry";
import {applyResourceStatus} from "@/Carburetor/Resource/Status/applyResourceStatus";

const noop = (): void => undefined;

/** Owns cache load, settlement, and Suspense transitions. */
export abstract class ResourceCacheLifecycle<T, TArgs extends TResourceArgs> extends ResourceCacheState<T, TArgs> {
    /** Initializes the loader and cache options for the lifecycle.
     *
     * @param loader - the resource loader driving entries.
     * @param options - cache behavior options.
     */
    protected constructor(loader: TResourceLoader<T, TArgs>, options: IResourceCacheOptions<TArgs> = {}) {
        super(loader, options);
        this.load = this.load.bind(this);
        this.refresh = this.refresh.bind(this);
    }

    /** Load an entry unless its current value is fresh.
     *
     * @param args - loader arguments; stray event arguments are dropped.
     */
    public load(...args: TArgs): Promise<void> {
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        return this.runLoad(dropEventArgs(args));
    }

    /** Request an entry even when its current value is fresh; always restarts.
     *
     * @param args - loader arguments; stray event arguments are dropped.
     */
    public refresh(...args: TArgs): Promise<void> {
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        return this.runRefresh(dropEventArgs(args));
    }

    /** Load an entry unless its current value is fresh (the bound `load` body). */
    private runLoad(args: TArgs): Promise<void> {
        let key: string;
        try {
            key = this[R.keyOf](args);
        } catch (error: unknown) {
            return Promise.reject(error);
        }
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        const entry = this.data.entries[key];
        this[R.touch](key);
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        if (entry && entry.status === EResourceStatus.Success && !this[R.isStale](entry)) {
            return Promise.resolve();
        }
        return this[R.fetch](key, args);
    }

    /** Request an entry even when its current value is fresh; always restarts (the bound `refresh` body). */
    private runRefresh(args: TArgs): Promise<void> {
        let key: string;
        try {
            key = this[R.keyOf](args);
        } catch (error: unknown) {
            return Promise.reject(error);
        }
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        this[R.touch](key);
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        return this[R.fetch](key, args, false, true);
    }

    /** Return a ready value or throw its pending request or raw failure.
     *
     * @param args - arguments identifying the cache key.
     */
    public suspend(...args: TArgs): T {
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        const key = this[R.keyOf](args);
        const entry = this.data.entries[key];
        this[R.touch](key);
        if (entry && entry.status === EResourceStatus.Success) {
            if (this[R.isStale](entry) && !entry.failed && !this[R.hasRequest](key)) {
                void this[R.fetch](key, args, true).catch(noop);
            }
            return entry.data as T;
        }
        if (entry && entry.status === EResourceStatus.Error) {
            if (entry.invalidated && !entry.failed) throw this[R.fetch](key, args, true);
            const runtime = this[R.runtimeFor](key);
            const answer = runtime?.answer;
            if (answer && answer.entry !== entry) {
                runtime.answer = undefined;
                this[R.runtimeRecords] = trimCacheRuntime(this[R.runtimeRecords], key, runtime);
            }
            const failure = answer?.entry === entry ? answer.failure : undefined;
            throw failure ? failure.value : new Error(entry.error || 'Carburetor: resource failed');
        }
        throw this[R.runtimeRecords]?.get(key)?.request?.promise || this[R.fetch](key, args, true);
    }

    /** Start or reuse a request for a cache entry.
     *
     * @param key - encoded cache key.
     * @param args - loader arguments for the key.
     * @param deferNotification - defer Pending subscribers when called by suspend.
     * @param force - restart (abort and replace) any known in-flight request for the key.
     */
    public [R.fetch](
        key: string, args: TArgs, deferNotification: boolean = false, force: boolean = false,
    ): Promise<void> {
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        const known = this[R.runtimeRecords]?.get(key)?.request;
        if (known && !force) return known.promise;
        const superseded = known;

        const entry = this.data.entries[key];
        const prepared = prepareCacheRequest(this.data, key, entry);
        const prior = this.data;
        const priorStatus = entry?.status;
        const priorError = entry?.error;
        const priorRefreshing = entry?.refreshing;
        const runtime = this[R.runtimeFor](key, true) as ICacheRuntime<T>;
        const controller = new AbortController();
        let resolveRequest: (value: void | PromiseLike<void>) => void = noop;
        let rejectRequest: (error: unknown) => void = noop;
        const promise = new Promise<void>((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        });
        const request: ICacheRequest = {
            controller,
            promise,
            generation: ++runtime.generation,
            invalidationEpoch: runtime.invalidationEpoch,
            retryingFailure: !!entry && (
                entry.status === EResourceStatus.Error || entry.failed || entry.error !== undefined ||
                runtime.answer?.failure !== undefined
            ),
            resolve: resolveRequest,
        };
        runtime.request = request;
        // Any reentrant start from an abort listener then joins this already-registered request.
        superseded?.controller.abort();
        if (storeLifecycle.isDisposed(this)) {
            runtime.request = undefined;
            void promise.catch(noop);
            rejectRequest(new Error('Carburetor: store has been disposed'));
            return promise;
        }
        try {
            this[R.markLoading](key, deferNotification, entry, prepared, request);
            if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
            if (this[R.isCurrent](key, request)) this[R.evict](deferNotification);
        } catch (error: unknown) {
            if (this[R.isCurrent](key, request)) {
                runtime.request = undefined;
                controller.abort();
                if (!this[R.hasRequest](key)) {
                    try {
                        if (prepared && this.data === prepared) {
                            this[R.installState](prior, {
                                origin: 'operational', owner: request, representation: 'owned-operational',
                            });
                        } else if (!prepared && this.data === prior && !entry &&
                            this.data.entries[key]?.status === EResourceStatus.Pending) {
                            this[R.removeEntries]([key], false);
                        } else if (!prepared && this.data === prior && entry &&
                            this.data.entries[key] === entry) {
                            try {
                                const draft = this.draft;
                                const root = this.data;
                                const target = draft.entries[key];
                                const current = () => root.entries[key] === entry ? target : draft.entries[key];
                                applyResourceStatus(current(), priorStatus as EResourceStatus);
                                current().error = priorError;
                                current().refreshing = priorRefreshing as boolean;
                            } finally {
                                this.emitUpdate();
                            }
                        }
                    } catch {
                        // Keep the publication failure as the request's rejection.
                    }
                }
                this[R.runtimeRecords] = trimCacheRuntime(this[R.runtimeRecords], key, runtime);
            }
            void promise.catch(noop);
            rejectRequest(error);
            throw error;
        }

        if (!this[R.isCurrent](key, request)) {
            if (superseded) this[R.adopt](superseded, promise);
            rejectRequest(createCacheSupersededError(this, promise));
            return promise;
        }
        let answer: Promise<T>;
        try {
            // The union loader type is not directly callable; the runtime always passes the signal.
            answer = (this[R.loader] as (...a: unknown[]) => Promise<T>)(...args, controller.signal);
        } catch (error: unknown) {
            answer = Promise.reject(error);
        }
        void answer.then(
            (data: T) => this[R.settleSuccess](key, request, data),
            (error: unknown) => this[R.settleFailure](key, request, error)
        ).then(resolveRequest, rejectRequest);
        if (superseded) this[R.adopt](superseded, promise);
        return promise;
    }

    /** A replaced request's awaiters observe the successor's outcome.
     *
     * @param old - the request that was replaced and is resolving its awaiters through us.
     * @param successor - the replacement request's promise the old awaiters now observe.
     */
    public [R.adopt](old: ICacheRequest, successor: Promise<void>): void {
        void old.promise.catch(noop);
        old.resolve(successor);
    }

    /** Publish a joinable request with capabilities for eventual settlement.
     *
     * @param key - encoded cache key.
     * @param deferNotification - defer ordinary subscribers when called by suspend.
     * @param entry - the previous answer, if present.
     * @param prepared - writable operational replacement, if required.
     * @param request - the already-registered request owner.
     */
    public [R.markLoading](
        key: string, deferNotification: boolean, entry: IResourceEntry<T> | undefined,
        prepared: IResourceCacheData<T> | undefined, request: ICacheRequest
    ): void {
        if (prepared) {
            this[R.installState](prepared, {
                origin: 'operational',
                owner: request,
                representation: 'owned-operational',
                publication: deferNotification ? 'deferred' : 'sync',
            });
            return;
        }
        const draft = this.draft;
        if (!entry) {
            const next: IResourceEntry<T> = {...getInitialCacheEntry<T>()};
            applyResourceStatus(next, EResourceStatus.Pending);
            draft.entries[key] = next;
            this[R.eviction].create();
        } else if (entry.status !== EResourceStatus.Success) {
            const root = this.data;
            const target = draft.entries[key];
            const current = () => root.entries[key] === entry ? target : draft.entries[key];
            applyResourceStatus(current(), EResourceStatus.Pending);
            current().error = undefined;
        } else {
            draft.entries[key].refreshing = true;
        }
        if (deferNotification) this.emitSoon();
        else this.emitUpdate();
    }

    /** Check whether this exact request still owns the entry.
     *
     * @param key - encoded cache key.
     * @param request - request owner to compare.
     */
    public [R.isCurrent](key: string, request: ICacheRequest): boolean {
        const runtime = this[R.runtimeFor](key);
        return runtime?.request === request && runtime.generation === request.generation
            && !request.controller.signal.aborted;
    }

    /** Store the successful value from the current request.
     *
     * @param key - encoded cache key.
     * @param request - request owner reporting the value.
     * @param data - loader value adopted verbatim.
     */
    public [R.settleSuccess](key: string, request: ICacheRequest, data: T): void {
        if (!this[R.isCurrent](key, request)) return;
        const runtime = this[R.runtimeFor](key) as ICacheRuntime<T>;
        runtime.request = undefined;
        const entry = this.data.entries[key];
        if (!entry) {
            runtime.answer = undefined;
            this[R.eviction].lastUsed.delete(key);
            this[R.viewCache].delete(key);
            if (this[R.resolution]?.key === key) this[R.resolution] = undefined;
            this[R.runtimeRecords] = trimCacheRuntime(this[R.runtimeRecords], key, runtime);
            return;
        }
        const invalidated = request.invalidationEpoch !== runtime.invalidationEpoch;
        runtime.answer = undefined;
        if (this[R.isRetentionFree](key)) this[R.eviction].release();
        try {
            const draft = this.draft;
            const root = this.data;
            const target = draft.entries[key];
            const current = () => root.entries[key] === entry ? target : draft.entries[key];
            applyResourceStatus(current(), EResourceStatus.Success);
            current().data = data;
            current().error = undefined;
            current().updatedAt = Date.now();
            current().refreshing = false;
            current().invalidated = invalidated;
            current().failed = false;
        } finally {
            this.emitUpdate();
        }
        this[R.runtimeRecords] = trimCacheRuntime(this[R.runtimeRecords], key, runtime);
        this[R.evict]();
    }

    /** Store the raw failure owner and its serializable description.
     *
     * @param key - encoded cache key.
     * @param request - request owner reporting the failure.
     * @param error - raw rejected value, including undefined.
     */
    public [R.settleFailure](key: string, request: ICacheRequest, error: unknown): void {
        if (!this[R.isCurrent](key, request)) return;
        const runtime = this[R.runtimeFor](key) as ICacheRuntime<T>;
        runtime.request = undefined;
        let message: string;
        let thrown: {error: unknown} | undefined;
        try {
            message = describeError(error);
        } catch (descriptionError: unknown) {
            message = 'Carburetor: resource failed';
            thrown = {error: descriptionError};
        }
        if (this[R.runtimeFor](key) !== runtime || runtime.generation !== request.generation
            || runtime.request !== undefined || request.controller.signal.aborted) {
            if (thrown) throw thrown.error;
            return;
        }
        const entry = this.data.entries[key];
        if (!entry) {
            runtime.answer = undefined;
            this[R.eviction].lastUsed.delete(key);
            this[R.viewCache].delete(key);
            if (this[R.resolution]?.key === key) this[R.resolution] = undefined;
            this[R.runtimeRecords] = trimCacheRuntime(this[R.runtimeRecords], key, runtime);
            if (thrown) throw thrown.error;
            return;
        }
        if (this[R.isRetentionFree](key)) this[R.eviction].release();
        const hasData = entry.status === EResourceStatus.Success || entry.data !== undefined;
        const status = hasData ? entry.status : EResourceStatus.Error;
        runtime.answer = {key, entry, failure: {value: error, message, status}};
        const invalidated = request.invalidationEpoch !== runtime.invalidationEpoch;
        try {
            const draft = this.draft;
            const root = this.data;
            const target = draft.entries[key];
            const current = () => root.entries[key] === entry ? target : draft.entries[key];
            current().error = message;
            current().refreshing = false;
            current().failed = !invalidated;
            if (!hasData) applyResourceStatus(current(), EResourceStatus.Error);
        } finally {
            this.emitUpdate();
        }
        this[R.evict]();
        if (thrown) throw thrown.error;
    }
}
