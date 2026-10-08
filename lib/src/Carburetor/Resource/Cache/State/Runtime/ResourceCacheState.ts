import {getInitialCacheEntry} from '@/Carburetor/Resource/Cache/State/getInitialCacheEntry';
import {PATH_SEPARATOR} from '@/Carburetor/Store/Paths/PathSeparator';
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
import {IStateInstallation, IStateRestoreClaim, STATE_PUBLIC_REPLACEMENT} from "@/Carburetor/Models/Paths";
import {Carburetor} from "@/Carburetor/Store/Carburetor";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {buildCacheRestore} from "@/Carburetor/Resource/Cache/State/buildCacheRestore";
import {removeCacheEntries} from "@/Carburetor/Resource/Cache/State/Mutation/removeCacheEntries";
import {prepareCacheInvalidation} from "@/Carburetor/Resource/Cache/State/Mutation/prepareCacheInvalidation";
import {applyCacheInvalidation} from "@/Carburetor/Resource/Cache/State/Mutation/applyCacheInvalidation";
import {EvictionLedger} from "@/Carburetor/Resource/Cache/EvictionLedger";
import {DEFAULT_MAX_ENTRIES, DEFAULT_TTL, ICacheRequest, ICacheRuntime} from "./Models";
import {trimCacheRuntime} from "./Registry";

/** Owns cache root installation, cancellation, invalidation and eviction. */
export abstract class ResourceCacheState<T, TArgs> extends Carburetor<IResourceCacheData<T>> {
    /** Changes when an abort listener starts a newer restore or replacement. */
    private restoreGeneration: number = 0;
    /** Bumped when entries may vanish: tells a removal from a not-yet-created entry. */
    private removalEpoch: number = 0;
    /** Defers ordinary delivery until a bulk request/removal operation closes. */
    private bulkDepth: number = 0;
    /** Age limit after which successful entries need refresh. */
    protected ttl: number;
    /** Maximum count of unretained entries. */
    protected maxEntries: number;
    /** Lazy per-key request and raw-answer ownership. */
    protected runtimeRecords: Map<string, ICacheRuntime<T>> | undefined;
    /** Stable caller-facing views for unchanged entries. */
    protected viewCache: Map<string, IResourceView<T>> = new Map<string, IResourceView<T>>();
    /** Entry count, LRU order, and eviction hysteresis. */
    protected eviction: EvictionLedger = new EvictionLedger();

    /** Resolve arguments to their encoded cache key.
     *
     * @param args - arguments serialized for key lookup.
     */
    protected abstract keyOf(args: TArgs): string;

    /** Configure the loader and cache limits.
     *
     * @param loader - resource producer.
     * @param options - TTL, entry and primitive key capacities, and update scheduler.
     */
    protected constructor(protected loader: TResourceLoader<T, TArgs>, options: IResourceCacheOptions = {}) {
        super({entries: {}}, options.scheduler);
        this.ttl = options.ttl === undefined ? DEFAULT_TTL : options.ttl;
        this.maxEntries = options.maxEntries === undefined ? DEFAULT_MAX_ENTRIES : options.maxEntries;
    }

    /** Lazily obtains the coherent request/answer record for a key.
     *
     * @param key - encoded cache key.
     * @param create - allocate a record when starting a request.
     */
    protected runtimeFor(key: string, create: boolean = false): ICacheRuntime<T> | undefined {
        let runtime = this.runtimeRecords?.get(key);
        if (!runtime && create) {
            runtime = {generation: 0, invalidationEpoch: 0};
            (this.runtimeRecords ??= new Map()).set(key, runtime);
        }
        return runtime;
    }

    /** Checks whether a current request owns a key.
     *
     * @param key - encoded cache key.
     */
    protected hasRequest(key: string): boolean {
        return this.runtimeRecords?.get(key)?.request !== undefined;
    }

    /** Install a public cache replacement through Core's commit boundary.
     *
     * @param data - replacement root adopted verbatim.
     */
    public setData(data: IResourceCacheData<T>): IResourceCacheData<T> {
        this.removalEpoch++;
        return this.installState(data, STATE_PUBLIC_REPLACEMENT);
    }

    /** Restore a cache snapshot without reviving replaced requests.
     *
     * @param data - snapshot or exact history endpoint.
     */
    public restore(data: IResourceCacheData<T>): void {
        this.removalEpoch++;
        const generation = ++this.restoreGeneration;
        const active: ICacheRequest[] = [];
        this.runtimeRecords?.forEach((runtime) => {
            if (runtime.request) active.push(runtime.request);
        });
        this.runtimeRecords = undefined;
        this.viewCache.clear();
        this.eviction.reset();
        active.forEach((request) => request.controller.abort());
        if (generation !== this.restoreGeneration) return;

        const claim: IStateRestoreClaim | undefined = this.patchObservers?.claimRestore(data);
        const ownedReplay = claim?.adopt === true;
        const liveRuntimeRecords = this.runtimeRecords as Map<string, ICacheRuntime<T>> | undefined;
        const liveKeys: string[] = [];
        liveRuntimeRecords?.forEach((runtime, key) => {
            if (runtime.request) liveKeys.push(key);
        });
        const next = buildCacheRestore(
            data, ownedReplay, this.data, liveKeys,
            (key) => this.touch(key), (key) => this.eviction.lastUsed.has(key)
        );
        this.installState(next, {
            origin: 'restore', owner: claim?.owner, representation: claim?.representation ?? 'public',
        });
    }

    /** Commit a prepared root and rebind surviving raw-answer owners during operational COW.
     *
     * @param next - prepared resource graph.
     * @param installation - origin, owner, and graph representation.
     */
    protected installState(next: IResourceCacheData<T>, installation: IStateInstallation): IResourceCacheData<T> {
        const previous = this.data;
        if (installation.origin === 'operational') {
            this.runtimeRecords?.forEach((runtime, key) => {
                const answer = runtime.answer;
                if (answer && answer.entry === previous.entries[key] && next.entries[key]) {
                    answer.entry = next.entries[key];
                }
            });
        }
        try {
            return this.commitState(next, installation);
        } catch (error: unknown) {
            if (this.data === previous && installation.origin === 'operational') {
                this.runtimeRecords?.forEach((runtime, key) => {
                    const answer = runtime.answer;
                    if (answer && answer.entry === next.entries[key] && previous.entries[key]) {
                        answer.entry = previous.entries[key];
                    }
                });
            }
            throw error;
        }
    }

    /** Record an entry access for eviction ordering.
     *
     * @param key - encoded cache key.
     */
    protected touch(key: string): void {
        this.eviction.touch(key);
    }

    /** Subscribe and release eviction hysteresis when replacing a registration ID.
     *
     * @param callback - subscriber callback.
     * @param options - subscription identity and read paths.
     */
    public subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        if (options.id !== undefined && Object.prototype.hasOwnProperty.call(this.subscribers, options.id)) {
            this.eviction.release();
        }
        // Creating a Pending entry changes its ancestor path, but data-only readers still
        // see exactly the absent defaults. Suppress only that first default-only creation;
        // all subsequent notifications (especially invalidated true/false) remain untouched.
        const absent = new Set<string>();
        const defaults = getInitialCacheEntry<T>();
        const reads = options.reads;
        if (reads !== undefined && reads.size > 0) {
            for (const path of reads) {
                const end = path.lastIndexOf(PATH_SEPARATOR);
                const parent = path.slice(0, end);
                const field = path.slice(end + 1);
                if (!parent.startsWith(`entries${PATH_SEPARATOR}`) || field === 'status' ||
                    !Object.prototype.hasOwnProperty.call(defaults, field)) {
                    absent.clear();
                    break;
                }
                const escaped = parent.slice('entries'.length + PATH_SEPARATOR.length);
                const key = escaped.replace(/~1/g, PATH_SEPARATOR).replace(/~0/g, '~');
                if (this.data.entries[key]) {
                    absent.clear();
                    break;
                }
                absent.add(key);
            }
        }
        if (absent.size === 0) return super.subscribe(callback, options);
        let epoch = this.removalEpoch;
        return super.subscribe(() => {
            // A removal since the last delivery (even one collapsed with the creation) must render: the
            // reader has to reload what vanished.
            const removed = epoch !== this.removalEpoch;
            epoch = this.removalEpoch;
            const defaultCreation = !removed && absent.size > 0 && Array.from(absent).every((key) => {
                const entry = this.data.entries[key];
                return entry === undefined || (entry.status === EResourceStatus.Pending && entry.data === undefined &&
                    entry.error === undefined && entry.updatedAt === undefined &&
                    !entry.refreshing && !entry.invalidated && !entry.failed);
            });
            if (defaultCreation) {
                if (Array.from(absent).every(key => this.data.entries[key] !== undefined)) absent.clear();
            } else {
                absent.clear();
                callback();
            }
        }, options);
    }

    /** Unsubscribe and release any entry the reader retained.
     *
     * @param id - subscription identity.
     */
    public unsubscribe(id: string): void {
        if (Object.prototype.hasOwnProperty.call(this.subscribers, id)) this.eviction.release();
        super.unsubscribe(id);
    }

    /** Abort the request for one argument set.
     *
     * @param args - arguments identifying the cache key.
     */
    public abort(args: TArgs): void {
        this.abortKey(this.keyOf(args));
    }

    /** Abort every in-flight request with one delivered publication. */
    public abortAll(): void {
        this.bulkDepth++;
        try {
            const requests: Array<[string, ICacheRequest]> = [];
            this.runtimeRecords?.forEach((runtime, key) => {
                if (runtime.request) requests.push([key, runtime.request]);
            });
            requests.forEach(([key, request]) => {
                if (this.runtimeFor(key)?.request === request) this.abortKey(key);
            });
        } finally {
            this.finishBulk();
        }
    }

    /** Mark one cache entry stale without removing its data.
     *
     * @param args - arguments identifying the cache key.
     */
    public invalidate(args: TArgs): void {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];
        if (!entry) return;
        const prepared = prepareCacheInvalidation(this.data, key);
        const runtime = this.runtimeFor(key);
        if (runtime?.request) runtime.invalidationEpoch++;
        if (prepared) {
            this.installState(prepared, {origin: 'operational', owner: {}, representation: 'owned-operational'});
        } else if (entry.invalidated !== true || entry.failed !== false) {
            this.update((draft) => applyCacheInvalidation(this.data, draft, key));
        }
    }

    /** Preflight then mark every entry stale in one operation. */
    public invalidateAll(): void {
        const keys = Object.keys(this.data.entries);
        if (keys.length === 0) return;
        const prepared = prepareCacheInvalidation(this.data, keys);
        for (const key of keys) {
            const runtime = this.runtimeFor(key);
            if (runtime?.request) runtime.invalidationEpoch++;
        }
        if (prepared) {
            this.installState(prepared, {origin: 'operational', owner: {}, representation: 'owned-operational'});
        } else {
            this.update((draft) => applyCacheInvalidation(this.data, draft, keys));
        }
    }

    /** Forget one entry and cancel its request.
     *
     * @param args - arguments identifying the cache key.
     */
    public forget(args: TArgs): void {
        this.forgetKey(this.keyOf(args));
    }

    /** Forget all entries and cancel their requests in one publication.
     *
     * Settled entries can share one removal preparation only when the per-key forget, abort, and
     * removal hooks are inherited unchanged. Subclasses keep the original per-key call order.
     */
    public forgetAll(): void {
        this.bulkDepth++;
        try {
            const keys = Object.keys(this.data.entries);
            if (keys.length === 0) return;

            const base = ResourceCacheState.prototype;
            if (this.forgetKey === base.forgetKey && this.abortKey === base.abortKey &&
                this.removeEntries === base.removeEntries) {
                // Batch base hooks only when no synchronous abort listener can reenter.
                let hasActiveRequest = false;
                for (let index = 0; index < keys.length; index++) {
                    if (this.hasRequest(keys[index])) {
                        hasActiveRequest = true;
                        break;
                    }
                }
                if (!hasActiveRequest) {
                    this.removeEntries(keys, false);
                    return;
                }
            }

            keys.forEach((key: string) => this.forgetKey(key));
        } finally {
            this.finishBulk();
        }
    }

    /** Close a bulk phase without adding a second operation fact. */
    private finishBulk(): void {
        this.bulkDepth--;
        if (this.bulkDepth === 0 && (this.draftTouched || this.writes.size > 0)) {
            super.emitUpdate(undefined, true);
        }
    }

    /** Coalesce bulk delivery while retaining queued mutation/install origins.
     *
     * @param installation - root-install fact, when present.
     * @param deferredContinuation - whether the queued publication is being closed.
     */
    protected emitUpdate(
        installation?: IStateInstallation, deferredContinuation: boolean = false
    ): void {
        if (this.bulkDepth === 0) {
            super.emitUpdate(installation, deferredContinuation);
        } else if (!installation && (this.writes.size > 0 || !this.draftTouched)) {
            this.rememberPublication();
        }
    }

    /** Remove a resolved key after abort-callback reentry has been checked.
     *
     * @param key - encoded cache key.
     */
    protected forgetKey(key: string): void {
        this.abortKey(key);
        if (this.hasRequest(key)) return;
        if (!this.data.entries[key]) {
            this.runtimeRecords?.delete(key);
            if (this.runtimeRecords?.size === 0) this.runtimeRecords = undefined;
            this.eviction.lastUsed.delete(key);
            this.viewCache.delete(key);
            return;
        }
        this.removeEntries([key], false);
    }

    /** Check whether a successful entry requires a fresh load.
     *
     * @param entry - current cache entry.
     */
    protected isStale(entry: IResourceEntry<T>): boolean {
        if (entry.invalidated || entry.updatedAt === undefined) return true;
        if (this.ttl === Infinity) return false;
        return Date.now() - entry.updatedAt > this.ttl;
    }

    /** Evict least-recently-used unretained entries.
     *
     * @param deferNotification - deliver the removal on a microtask when true.
     */
    protected evict(deferNotification: boolean = false): void {
        if (this.eviction.shouldSkip(this.maxEntries)) return;
        const doomed = this.eviction.selectVictims(this.maxEntries, (key: string): boolean => {
            return this.hasRequest(key) || this.subscriberIndex.hasReaderAt(joinPath('entries', key));
        });
        if (doomed.length > 0) this.removeEntries(doomed, deferNotification);
    }

    /** Remove actual dictionary slots before reporting their eviction.
     *
     * @param keys - entries to remove.
     * @param deferNotification - defer ordinary subscriber delivery when true.
     */
    protected removeEntries(keys: string[], deferNotification: boolean): void {
        removeCacheEntries(this.data, keys, deferNotification, {
            replace: (_previous, next) => this.installState(next, {
                origin: 'operational', owner: {}, representation: 'owned-operational',
                publication: deferNotification ? 'deferred' : 'sync',
            }),
            draft: () => this.draft,
            current: () => this.data,
            forgot: (key, replaced) => {
                this.removalEpoch++;
                this.eviction.forget(key, replaced);
                if (!replaced) {
                    const runtime = this.runtimeFor(key);
                    if (runtime) {
                        runtime.answer = undefined;
                        this.runtimeRecords = trimCacheRuntime(this.runtimeRecords, key, runtime);
                    }
                    this.viewCache.delete(key);
                }
            },
            publish: (defer) => { if (defer) this.emitSoon(); else this.emitUpdate(); },
        });
    }

    /** Check whether a key has neither a request nor a reader.
     *
     * @param key - encoded cache key.
     */
    protected isRetentionFree(key: string): boolean {
        return !this.hasRequest(key) && !this.subscriberIndex.hasReaderAt(joinPath('entries', key));
    }

    /** Detach a request before abort listeners and reset only its surviving cancellation.
     *
     * @param key - encoded cache key.
     */
    protected abortKey(key: string): void {
        const runtime = this.runtimeFor(key);
        const request = runtime?.request;
        if (!runtime || !request) return;
        runtime.request = undefined;
        request.controller.abort();
        if (this.hasRequest(key)) return;

        const entry = this.data.entries[key];
        if (!entry || (entry.status !== EResourceStatus.Pending && !entry.refreshing)) {
            this.runtimeRecords = trimCacheRuntime(this.runtimeRecords, key, runtime);
            return;
        }
        const retryFailed = request.retryingFailure || runtime.answer?.failure !== undefined;
        try {
            this.update((draft) => {
                if (entry.status === EResourceStatus.Pending) draft.entries[key].status = EResourceStatus.Idle;
                else draft.entries[key].refreshing = false;
                draft.entries[key].failed ||= retryFailed;
            });
        } finally {
            this.runtimeRecords = trimCacheRuntime(this.runtimeRecords, key, runtime);
        }
    }
}
