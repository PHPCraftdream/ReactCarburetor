import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceCacheData, IResourceEntry} from "@/Carburetor/Models/Resource";
import {describeError} from "@/Carburetor/Resource/describeError";
import {createAbortHandle} from "@/Carburetor/Resource/createAbortHandle";
import {createCacheSupersededError} from "@/Carburetor/Resource/createCacheSupersededError";
import {getInitialCacheEntry} from "./State/getInitialCacheEntry";
import {prepareCacheRequest} from "./State/prepareCacheRequest";
import {ICacheRequest, ICacheRuntime} from "./State/Runtime/Models";
import {ResourceCacheState} from "./State/Runtime/ResourceCacheState";
import {trimCacheRuntime} from "./State/Runtime/Registry";

/** Owns cache load, settlement, and Suspense transitions. */
export abstract class ResourceCacheLifecycle<T, TArgs> extends ResourceCacheState<T, TArgs> {
    /** Load an entry unless its current value is fresh.
     *
     * @param args - arguments identifying the cache key.
     */
    public load(args: TArgs): Promise<void> {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];
        this.touch(key);
        if (entry && entry.status === EResourceStatus.Success && !this.isStale(entry)) {
            return Promise.resolve();
        }
        return this.fetch(key, args);
    }

    /** Request an entry even when its current value is fresh.
     *
     * @param args - arguments identifying the cache key.
     */
    public refresh(args: TArgs): Promise<void> {
        const key = this.keyOf(args);
        this.touch(key);
        return this.fetch(key, args);
    }

    /** Return a ready value or throw its pending request or raw failure.
     *
     * @param args - arguments identifying the cache key.
     */
    public suspend(args: TArgs): T {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];
        this.touch(key);
        if (entry && entry.status === EResourceStatus.Success) {
            if (this.isStale(entry) && !entry.failed && !this.hasRequest(key)) {
                void this.fetch(key, args, true);
            }
            return entry.data as T;
        }
        if (entry && entry.status === EResourceStatus.Error) {
            if (entry.invalidated && !entry.failed) throw this.fetch(key, args, true);
            const runtime = this.runtimeFor(key);
            const answer = runtime?.answer;
            if (answer && answer.entry !== entry) {
                runtime.answer = undefined;
                this.runtimeRecords = trimCacheRuntime(this.runtimeRecords, key, runtime);
            }
            const failure = answer?.entry === entry ? answer.failure : undefined;
            throw failure ? failure.value : new Error(entry.error || 'Carburetor: resource failed');
        }
        throw this.runtimeRecords?.get(key)?.request?.promise || this.fetch(key, args, true);
    }

    /** Start or reuse a request for a cache entry.
     *
     * @param key - encoded cache key.
     * @param args - loader arguments for the key.
     * @param deferNotification - defer Pending subscribers when called by suspend.
     */
    protected fetch(key: string, args: TArgs, deferNotification: boolean = false): Promise<void> {
        const known = this.runtimeRecords?.get(key)?.request;
        if (known) return known.promise;

        const entry = this.data.entries[key];
        const prepared = prepareCacheRequest(this.data, key, entry);
        const prior = this.data;
        const priorStatus = entry?.status;
        const priorError = entry?.error;
        const priorRefreshing = entry?.refreshing;
        const runtime = this.runtimeFor(key, true) as ICacheRuntime<T>;
        const controller = createAbortHandle();
        let resolveRequest: () => void = () => undefined;
        let rejectRequest: (error: unknown) => void = () => undefined;
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
        };
        runtime.request = request;
        try {
            this.markLoading(key, deferNotification, entry, prepared, request);
            if (this.isCurrent(key, request)) this.evict(deferNotification);
        } catch (error: unknown) {
            if (this.isCurrent(key, request)) {
                runtime.request = undefined;
                controller.abort();
                if (!this.hasRequest(key)) {
                    try {
                        if (prepared && this.data === prepared) {
                            this.installState(prior, {
                                origin: 'operational', owner: request, representation: 'owned-operational',
                            });
                        } else if (!prepared && this.data === prior && !entry &&
                            this.data.entries[key]?.status === EResourceStatus.Pending) {
                            this.removeEntries([key], false);
                        } else if (!prepared && this.data === prior && entry &&
                            this.data.entries[key] === entry) {
                            this.update((draft) => {
                                draft.entries[key].status = priorStatus as EResourceStatus;
                                draft.entries[key].error = priorError;
                                draft.entries[key].refreshing = priorRefreshing as boolean;
                            });
                        }
                    } catch {
                        // Keep the publication failure as the request's rejection.
                    }
                }
                this.runtimeRecords = trimCacheRuntime(this.runtimeRecords, key, runtime);
            }
            void promise.catch(() => undefined);
            rejectRequest(error);
            throw error;
        }

        if (!this.isCurrent(key, request)) {
            rejectRequest(createCacheSupersededError());
            return promise;
        }
        let answer: Promise<T>;
        try {
            answer = this.loader(args, controller.signal);
        } catch (error: unknown) {
            answer = Promise.reject(error);
        }
        void answer.then(
            (data: T) => this.settleSuccess(key, request, data),
            (error: unknown) => this.settleFailure(key, request, error)
        ).then(resolveRequest, rejectRequest);
        return promise;
    }

    /** Publish a joinable request with capabilities for eventual settlement.
     *
     * @param key - encoded cache key.
     * @param deferNotification - defer ordinary subscribers when called by suspend.
     * @param entry - the previous answer, if present.
     * @param prepared - writable operational replacement, if required.
     * @param request - the already-registered request owner.
     */
    protected markLoading(
        key: string, deferNotification: boolean, entry: IResourceEntry<T> | undefined,
        prepared: IResourceCacheData<T> | undefined, request: ICacheRequest
    ): void {
        if (prepared) {
            this.installState(prepared, {
                origin: 'operational',
                owner: request,
                representation: 'owned-operational',
                publication: deferNotification ? 'deferred' : 'sync',
            });
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

    /** Check whether this exact request still owns the entry.
     *
     * @param key - encoded cache key.
     * @param request - request owner to compare.
     */
    protected isCurrent(key: string, request: ICacheRequest): boolean {
        const runtime = this.runtimeFor(key);
        return runtime?.request === request && runtime.generation === request.generation
            && !request.controller.signal.aborted;
    }

    /** Store the successful value from the current request.
     *
     * @param key - encoded cache key.
     * @param request - request owner reporting the value.
     * @param data - loader value adopted verbatim.
     */
    protected settleSuccess(key: string, request: ICacheRequest, data: T): void {
        if (!this.isCurrent(key, request)) return;
        const runtime = this.runtimeFor(key) as ICacheRuntime<T>;
        runtime.request = undefined;
        const entry = this.data.entries[key];
        if (!entry) {
            runtime.answer = undefined;
            this.eviction.lastUsed.delete(key);
            this.viewCache.delete(key);
            this.runtimeRecords = trimCacheRuntime(this.runtimeRecords, key, runtime);
            return;
        }
        const invalidated = request.invalidationEpoch !== runtime.invalidationEpoch;
        runtime.answer = undefined;
        if (this.isRetentionFree(key)) this.eviction.release();
        this.update((draft: IResourceCacheData<T>) => {
            draft.entries[key].status = EResourceStatus.Success;
            draft.entries[key].data = data;
            draft.entries[key].error = undefined;
            draft.entries[key].updatedAt = Date.now();
            draft.entries[key].refreshing = false;
            draft.entries[key].invalidated = invalidated;
            draft.entries[key].failed = false;
        });
        this.runtimeRecords = trimCacheRuntime(this.runtimeRecords, key, runtime);
        this.evict();
    }

    /** Store the raw failure owner and its serializable description.
     *
     * @param key - encoded cache key.
     * @param request - request owner reporting the failure.
     * @param error - raw rejected value, including undefined.
     */
    protected settleFailure(key: string, request: ICacheRequest, error: unknown): void {
        if (!this.isCurrent(key, request)) return;
        const runtime = this.runtimeFor(key) as ICacheRuntime<T>;
        runtime.request = undefined;
        const entry = this.data.entries[key];
        if (!entry) {
            runtime.answer = undefined;
            this.eviction.lastUsed.delete(key);
            this.viewCache.delete(key);
            this.runtimeRecords = trimCacheRuntime(this.runtimeRecords, key, runtime);
            return;
        }
        if (this.isRetentionFree(key)) this.eviction.release();
        const hasData = entry.status === EResourceStatus.Success || entry.data !== undefined;
        const message = describeError(error);
        const status = hasData ? entry.status : EResourceStatus.Error;
        runtime.answer = {key, entry, failure: {value: error, message, status}};
        const invalidated = request.invalidationEpoch !== runtime.invalidationEpoch;
        this.update((draft: IResourceCacheData<T>) => {
            draft.entries[key].error = message;
            draft.entries[key].refreshing = false;
            draft.entries[key].failed = !invalidated;
            if (!hasData) draft.entries[key].status = EResourceStatus.Error;
        });
        this.evict();
    }
}
