import {R} from "@/Carburetor/Store/Diagnostics/Internal/ResourceSymbols";
import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import {getInitialCacheEntry} from '@/Carburetor/Resource/Cache/State/getInitialCacheEntry';
import {PATH_SEPARATOR} from '@/Carburetor/Store/Paths/PathSeparator';
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {
    IResourceCacheData,
    IResourceCacheOptions,
    IResourceEntry,
    IResourceResolution,
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
    /** Loader retained independently of subclass names. */
    public [R.loader]!: TResourceLoader<T, TArgs>;
    /** Changes when an abort listener starts a newer restore or replacement. */
    private [R.restoreGeneration]: number = 0;
    /** Bumped when entries may vanish: tells a removal from a not-yet-created entry. */
    private [R.removalEpoch]: number = 0;
    /** Defers ordinary delivery until a bulk request/removal operation closes. */
    private [R.bulkDepth]: number = 0;
    /** Age limit after which successful entries need refresh. */
    public [R.ttl]!: number;
    /** Maximum count of unretained entries. */
    public [R.maxEntries]!: number;
    /** Lazy per-key request and raw-answer ownership. */
    public [R.runtimeRecords]: Map<string, ICacheRuntime<T>> | undefined;
    /** Stable caller-facing views for unchanged entries. */
    public [R.viewCache]: Map<string, IResourceView<T>> = new Map<string, IResourceView<T>>();
    /** Lazy most-recent resolution, released with its authoritative entry. */
    public [R.resolution]: IResourceResolution<T> | undefined;
    /** Entry count, LRU order, and eviction hysteresis. */
    public [R.eviction]: EvictionLedger = new EvictionLedger();

    /** Resolve arguments to their encoded cache key.
     *
     * @param args - arguments serialized for key lookup.
     */
    public abstract [R.keyOf](args: TArgs): string;

    /** Configure the loader and cache limits.
     *
     * @param loader - resource producer.
     * @param options - TTL, entry and primitive key capacities, and update scheduler.
     */
    protected constructor(loader: TResourceLoader<T, TArgs>, options: IResourceCacheOptions = {}) {
        super({entries: {}}, options.scheduler);
        this[R.loader] = loader;
        this[R.ttl] = options.ttl === undefined ? DEFAULT_TTL : options.ttl;
        this[R.maxEntries] = options.maxEntries === undefined ? DEFAULT_MAX_ENTRIES : options.maxEntries;
    }

    /** Lazily obtains the coherent request/answer record for a key.
     *
     * @param key - encoded cache key.
     * @param create - allocate a record when starting a request.
     */
    public [R.runtimeFor](key: string, create: boolean = false): ICacheRuntime<T> | undefined {
        let runtime = this[R.runtimeRecords]?.get(key);
        if (!runtime && create) {
            runtime = {generation: 0, invalidationEpoch: 0};
            (this[R.runtimeRecords] ??= new Map()).set(key, runtime);
        }
        return runtime;
    }

    /** Checks whether a current request owns a key.
     *
     * @param key - encoded cache key.
     */
    public [R.hasRequest](key: string): boolean {
        return this[R.runtimeRecords]?.get(key)?.request !== undefined;
    }

    /** Install a public cache replacement through Core's commit boundary.
     *
     * @param data - replacement root adopted verbatim.
     */
    public setData(data: IResourceCacheData<T>): IResourceCacheData<T> {
        this[R.removalEpoch]++;
        return this[R.installState](data, STATE_PUBLIC_REPLACEMENT);
    }

    /** Restore a cache snapshot without reviving replaced requests.
     *
     * @param data - snapshot or exact history endpoint.
     */
    public restore(data: IResourceCacheData<T>): void {
        this[R.removalEpoch]++;
        const generation = ++this[R.restoreGeneration];
        const active: ICacheRequest[] = [];
        this[R.runtimeRecords]?.forEach((runtime) => {
            if (runtime.request) active.push(runtime.request);
        });
        this[R.runtimeRecords] = undefined;
        this[R.viewCache].clear();
        this[R.resolution] = undefined;
        this[R.eviction].reset();
        active.forEach((request) => request.controller.abort());
        if (generation !== this[R.restoreGeneration]) return;

        const claim: IStateRestoreClaim | undefined = this[S.patchObservers]?.claimRestore(data);
        const ownedReplay = claim?.adopt === true;
        const liveRuntimeRecords = this[R.runtimeRecords] as Map<string, ICacheRuntime<T>> | undefined;
        const liveKeys: string[] = [];
        liveRuntimeRecords?.forEach((runtime, key) => {
            if (runtime.request) liveKeys.push(key);
        });
        const next = buildCacheRestore(
            data, ownedReplay, this.data, liveKeys,
            (key) => this[R.touch](key), (key) => this[R.eviction].lastUsed.has(key)
        );
        this[R.installState](next, {
            origin: 'restore', owner: claim?.owner, representation: claim?.representation ?? 'public',
        });
    }

    /** Commit a prepared root and rebind surviving raw-answer owners during operational COW.
     *
     * @param next - prepared resource graph.
     * @param installation - origin, owner, and graph representation.
     */
    public [R.installState](next: IResourceCacheData<T>, installation: IStateInstallation): IResourceCacheData<T> {
        const previous = this.data;
        if (installation.origin === 'operational') {
            this[R.runtimeRecords]?.forEach((runtime, key) => {
                const answer = runtime.answer;
                if (answer && answer.entry === previous.entries[key] && next.entries[key]) {
                    answer.entry = next.entries[key];
                }
            });
        }
        try {
            return this[S.commitState](next, installation);
        } catch (error: unknown) {
            if (this.data === previous && installation.origin === 'operational') {
                this[R.runtimeRecords]?.forEach((runtime, key) => {
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
    public [R.touch](key: string): void {
        this[R.eviction].touch(key);
    }

    /** Subscribe and release eviction hysteresis when replacing a registration ID.
     *
     * @param callback - subscriber callback.
     * @param options - subscription identity and read paths.
     */
    public subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        if (options.id !== undefined && Object.prototype.hasOwnProperty.call(this[S.subscribers], options.id)) {
            this[R.eviction].release();
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
        let epoch = this[R.removalEpoch];
        return super.subscribe(() => {
            // A removal since the last delivery (even one collapsed with the creation) must render: the
            // reader has to reload what vanished.
            const removed = epoch !== this[R.removalEpoch];
            epoch = this[R.removalEpoch];
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
        if (Object.prototype.hasOwnProperty.call(this[S.subscribers], id)) this[R.eviction].release();
        super.unsubscribe(id);
    }

    /** Abort the request for one argument set.
     *
     * @param args - arguments identifying the cache key.
     */
    public abort(args: TArgs): void {
        this[R.abortKey](this[R.keyOf](args));
    }

    /** Abort every in-flight request with one delivered publication. */
    public abortAll(): void {
        this[R.bulkDepth]++;
        try {
            const requests: Array<[string, ICacheRequest]> = [];
            this[R.runtimeRecords]?.forEach((runtime, key) => {
                if (runtime.request) requests.push([key, runtime.request]);
            });
            requests.forEach(([key, request]) => {
                if (this[R.runtimeFor](key)?.request === request) this[R.abortKey](key);
            });
        } finally {
            this[R.finishBulk]();
        }
    }

    /** Mark one cache entry stale without removing its data.
     *
     * @param args - arguments identifying the cache key.
     */
    public invalidate(args: TArgs): void {
        const key = this[R.keyOf](args);
        const entry = this.data.entries[key];
        if (!entry) return;
        const prepared = prepareCacheInvalidation(this.data, key);
        const runtime = this[R.runtimeFor](key);
        if (runtime?.request) runtime.invalidationEpoch++;
        if (prepared) {
            this[R.installState](prepared, {origin: 'operational', owner: {}, representation: 'owned-operational'});
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
            const runtime = this[R.runtimeFor](key);
            if (runtime?.request) runtime.invalidationEpoch++;
        }
        if (prepared) {
            this[R.installState](prepared, {origin: 'operational', owner: {}, representation: 'owned-operational'});
        } else {
            this.update((draft) => applyCacheInvalidation(this.data, draft, keys));
        }
    }

    /** Forget one entry and cancel its request.
     *
     * @param args - arguments identifying the cache key.
     */
    public forget(args: TArgs): void {
        this[R.forgetKey](this[R.keyOf](args));
    }

    /** Forget all entries and cancel their requests in one publication.
     *
     * Settled entries can share one removal preparation only when the per-key forget, abort, and
     * removal hooks are inherited unchanged. Subclasses keep the original per-key call order.
     */
    public forgetAll(): void {
        this[R.bulkDepth]++;
        try {
            const keys = Object.keys(this.data.entries);
            if (keys.length === 0) return;

            const base = ResourceCacheState.prototype;
            if (this[R.forgetKey] === base[R.forgetKey] && this[R.abortKey] === base[R.abortKey] &&
                this[R.removeEntries] === base[R.removeEntries]) {
                // Batch base hooks only when no synchronous abort listener can reenter.
                let hasActiveRequest = false;
                for (let index = 0; index < keys.length; index++) {
                    if (this[R.hasRequest](keys[index])) {
                        hasActiveRequest = true;
                        break;
                    }
                }
                if (!hasActiveRequest) {
                    this[R.removeEntries](keys, false);
                    return;
                }
            }

            keys.forEach((key: string) => this[R.forgetKey](key));
        } finally {
            this[R.finishBulk]();
        }
    }

    /** Close a bulk phase without adding a second operation fact. */
    private [R.finishBulk](): void {
        this[R.bulkDepth]--;
        if (this[R.bulkDepth] === 0 && (this[S.draftTouched] || this[S.writes].size > 0)) {
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
        if (this[R.bulkDepth] === 0) {
            super.emitUpdate(installation, deferredContinuation);
        } else if (!installation && (this[S.writes].size > 0 || !this[S.draftTouched])) {
            this[S.rememberPublication]();
        }
    }

    /** Remove a resolved key after abort-callback reentry has been checked.
     *
     * @param key - encoded cache key.
     */
    public [R.forgetKey](key: string): void {
        this[R.abortKey](key);
        if (this[R.hasRequest](key)) return;
        if (!this.data.entries[key]) {
            this[R.runtimeRecords]?.delete(key);
            if (this[R.runtimeRecords]?.size === 0) this[R.runtimeRecords] = undefined;
            this[R.eviction].lastUsed.delete(key);
            this[R.viewCache].delete(key);
            if (this[R.resolution]?.key === key) this[R.resolution] = undefined;
            return;
        }
        this[R.removeEntries]([key], false);
    }

    /** Check whether a successful entry requires a fresh load.
     *
     * @param entry - current cache entry.
     */
    public [R.isStale](entry: IResourceEntry<T>): boolean {
        if (entry.invalidated || entry.updatedAt === undefined) return true;
        if (this[R.ttl] === Infinity) return false;
        return Date.now() - entry.updatedAt > this[R.ttl];
    }

    /** Evict least-recently-used unretained entries.
     *
     * @param deferNotification - deliver the removal on a microtask when true.
     */
    public [R.evict](deferNotification: boolean = false): void {
        if (this[R.eviction].shouldSkip(this[R.maxEntries])) return;
        const doomed = this[R.eviction].selectVictims(this[R.maxEntries], (key: string): boolean => {
            return this[R.hasRequest](key) || this[S.subscriberIndex].hasReaderAt(joinPath('entries', key));
        });
        if (doomed.length > 0) this[R.removeEntries](doomed, deferNotification);
    }

    /** Remove actual dictionary slots before reporting their eviction.
     *
     * @param keys - entries to remove.
     * @param deferNotification - defer ordinary subscriber delivery when true.
     */
    public [R.removeEntries](keys: string[], deferNotification: boolean): void {
        removeCacheEntries(this.data, keys, deferNotification, {
            replace: (_previous, next) => this[R.installState](next, {
                origin: 'operational', owner: {}, representation: 'owned-operational',
                publication: deferNotification ? 'deferred' : 'sync',
            }),
            draft: () => this.draft,
            current: () => this.data,
            forgot: (key, replaced) => {
                this[R.removalEpoch]++;
                this[R.eviction].forget(key, replaced);
                if (!replaced) {
                    const runtime = this[R.runtimeFor](key);
                    if (runtime) {
                        runtime.answer = undefined;
                        this[R.runtimeRecords] = trimCacheRuntime(this[R.runtimeRecords], key, runtime);
                    }
                    this[R.viewCache].delete(key);
                    if (this[R.resolution]?.key === key) this[R.resolution] = undefined;
                }
            },
            publish: (defer) => { if (defer) this.emitSoon(); else this.emitUpdate(); },
        });
    }

    /** Check whether a key has neither a request nor a reader.
     *
     * @param key - encoded cache key.
     */
    public [R.isRetentionFree](key: string): boolean {
        return !this[R.hasRequest](key) && !this[S.subscriberIndex].hasReaderAt(joinPath('entries', key));
    }

    /** Detach a request before abort listeners and reset only its surviving cancellation.
     *
     * @param key - encoded cache key.
     */
    public [R.abortKey](key: string): void {
        const runtime = this[R.runtimeFor](key);
        const request = runtime?.request;
        if (!runtime || !request) return;
        runtime.request = undefined;
        request.controller.abort();
        if (this[R.hasRequest](key)) return;

        const entry = this.data.entries[key];
        if (!entry || (entry.status !== EResourceStatus.Pending && !entry.refreshing)) {
            this[R.runtimeRecords] = trimCacheRuntime(this[R.runtimeRecords], key, runtime);
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
            this[R.runtimeRecords] = trimCacheRuntime(this[R.runtimeRecords], key, runtime);
        }
    }
}
