import {R} from "@/Carburetor/Store/Diagnostics/Internal/ResourceSymbols";
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
        const key = this[R.keyOf](args);
        const entry = this.data.entries[key];
        this[R.touch](key);
        if (entry && entry.status === EResourceStatus.Success && !this[R.isStale](entry)) {
            return Promise.resolve();
        }
        return this[R.fetch](key, args);
    }

    /** Request an entry even when its current value is fresh.
     *
     * @param args - arguments identifying the cache key.
     */
    public refresh(args: TArgs): Promise<void> {
        const key = this[R.keyOf](args);
        this[R.touch](key);
        return this[R.fetch](key, args);
    }

    /** Return a ready value or throw its pending request or raw failure.
     *
     * @param args - arguments identifying the cache key.
     */
    public suspend(args: TArgs): T {
        const key = this[R.keyOf](args);
        const entry = this.data.entries[key];
        this[R.touch](key);
        if (entry && entry.status === EResourceStatus.Success) {
            if (this[R.isStale](entry) && !entry.failed && !this[R.hasRequest](key)) {
                void this[R.fetch](key, args, true);
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
     */
    public [R.fetch](key: string, args: TArgs, deferNotification: boolean = false): Promise<void> {
        const known = this[R.runtimeRecords]?.get(key)?.request;
        if (known) return known.promise;

        const entry = this.data.entries[key];
        const prepared = prepareCacheRequest(this.data, key, entry);
        const prior = this.data;
        const priorStatus = entry?.status;
        const priorError = entry?.error;
        const priorRefreshing = entry?.refreshing;
        const runtime = this[R.runtimeFor](key, true) as ICacheRuntime<T>;
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
            this[R.markLoading](key, deferNotification, entry, prepared, request);
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
                            this.update((draft) => {
                                const root = this.data;
                                const target = draft.entries[key];
                                const current = () => root.entries[key] === entry ? target : draft.entries[key];
                                current().status = priorStatus as EResourceStatus;
                                current().error = priorError;
                                current().refreshing = priorRefreshing as boolean;
                            });
                        }
                    } catch {
                        // Keep the publication failure as the request's rejection.
                    }
                }
                this[R.runtimeRecords] = trimCacheRuntime(this[R.runtimeRecords], key, runtime);
            }
            void promise.catch(() => undefined);
            rejectRequest(error);
            throw error;
        }

        if (!this[R.isCurrent](key, request)) {
            rejectRequest(createCacheSupersededError());
            return promise;
        }
        let answer: Promise<T>;
        try {
            answer = this[R.loader](args, controller.signal);
        } catch (error: unknown) {
            answer = Promise.reject(error);
        }
        void answer.then(
            (data: T) => this[R.settleSuccess](key, request, data),
            (error: unknown) => this[R.settleFailure](key, request, error)
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
            draft.entries[key] = {...getInitialCacheEntry<T>(), status: EResourceStatus.Pending};
            this[R.eviction].create();
        } else if (entry.status !== EResourceStatus.Success) {
            const root = this.data;
            const target = draft.entries[key];
            const current = () => root.entries[key] === entry ? target : draft.entries[key];
            current().status = EResourceStatus.Pending;
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
        this.update((draft: IResourceCacheData<T>) => {
            const root = this.data;
            const target = draft.entries[key];
            const current = () => root.entries[key] === entry ? target : draft.entries[key];
            current().status = EResourceStatus.Success;
            current().data = data;
            current().error = undefined;
            current().updatedAt = Date.now();
            current().refreshing = false;
            current().invalidated = invalidated;
            current().failed = false;
        });
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
        const entry = this.data.entries[key];
        if (!entry) {
            runtime.answer = undefined;
            this[R.eviction].lastUsed.delete(key);
            this[R.viewCache].delete(key);
            if (this[R.resolution]?.key === key) this[R.resolution] = undefined;
            this[R.runtimeRecords] = trimCacheRuntime(this[R.runtimeRecords], key, runtime);
            return;
        }
        if (this[R.isRetentionFree](key)) this[R.eviction].release();
        const hasData = entry.status === EResourceStatus.Success || entry.data !== undefined;
        const message = describeError(error);
        const status = hasData ? entry.status : EResourceStatus.Error;
        runtime.answer = {key, entry, failure: {value: error, message, status}};
        const invalidated = request.invalidationEpoch !== runtime.invalidationEpoch;
        this.update((draft: IResourceCacheData<T>) => {
            const root = this.data;
            const target = draft.entries[key];
            const current = () => root.entries[key] === entry ? target : draft.entries[key];
            current().error = message;
            current().refreshing = false;
            current().failed = !invalidated;
            if (!hasData) current().status = EResourceStatus.Error;
        });
        this[R.evict]();
    }
}
