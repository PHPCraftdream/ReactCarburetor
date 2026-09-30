import {
    IResourceCacheData,
    IResourceCacheOptions,
    IResourceResolution,
    IResourceSource,
    IResourceView,
    TResourceLoader,
} from "@/Carburetor/Models/Resource";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {TPath} from "@/Carburetor/Models/Paths";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {PATH_SEPARATOR} from "@/Carburetor/Store/Paths/PathSeparator";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {escapeCacheKey} from "./escapeCacheKey";
import {getInitialCacheEntry} from "./getInitialCacheEntry";
import {ResourceCacheLifecycle} from "./ResourceCacheLifecycle";
import {isViewCurrent} from "./isViewCurrent";

declare const process: {env: {NODE_ENV?: string}} | undefined;

// Every absent entry answers with the exact same shape regardless of T (data is always
// undefined), so one frozen instance serves every miss instead of a fresh object per call.
// Nothing ever mutates a view (see IResourceView's callers) or caches this one in viewCache,
// so sharing it across keys and across ResourceCache instances is safe.
const ABSENT_VIEW: IResourceView<unknown> = Object.freeze({...getInitialCacheEntry<unknown>(), stale: true});
const ENTRY_PATH_PREFIX = `entries${PATH_SEPARATOR}`;

const validateOptions = (options: IResourceCacheOptions): IResourceCacheOptions => {
    if (options.ttl !== undefined && (Number.isNaN(options.ttl) || options.ttl < 0)) {
        throw new RangeError('ResourceCache ttl must be a non-negative number');
    }

    if (options.maxEntries !== undefined && options.maxEntries !== Infinity
        && (!Number.isInteger(options.maxEntries) || options.maxEntries < 0)) {
        throw new RangeError('ResourceCache maxEntries must be a non-negative integer or Infinity');
    }

    return options;
};

/**
 * Many async answers, keyed by the arguments that produced them.
 *
 * `ResourceCarburetor` holds one slot, so loading with different arguments throws the previous answer
 * away. This holds an entry per argument set, each with its own status and freshness, which is the
 * shape an API layer needs — and the reason a consumer does not have to add a query library next to
 * the state engine.
 *
 * Entries live in a flat dictionary under keys from `escapeCacheKey`, so path tracking does the
 * precision for free: a component reading one entry is not woken by another entry's answer. See
 * docs/promise-cache.md for the decisions behind the shape, the escaped key and the TTL.
 */
export class ResourceCache<T, TArgs = void> extends ResourceCacheLifecycle<T, TArgs>
    implements IResourceSource<T, TArgs> {
    /** Most recently keyed arguments. */
    protected lastKeyArgs: TArgs | undefined = undefined;
    /** Serialized value of the most recently keyed arguments. */
    protected lastKeyJson: string | undefined = undefined;
    /** Cache key derived from the most recently keyed arguments. */
    protected lastKeyValue: string | undefined = undefined;
    /** Whether the mutable-arguments diagnostic was already reported. */
    protected keyMutationReported: boolean = false;
    /** Entries from the outer setData call, for reconciling raw failures before publication. */
    private replacedEntries: IResourceCacheData<T>['entries'] | undefined;

    /** Create a keyed cache for a resource loader.
     *
     * @param loader - Function that loads a resource.
     * @param options - Cache and scheduler settings.
     */
    constructor(loader: TResourceLoader<T, TArgs>, options: IResourceCacheOptions = {}) {
        super(loader, validateOptions(options));
    }

    /** Replace cache data while retaining the prior entry identities for failure reconciliation.
     *
     * @param data - New cache state to adopt.
     */
    public setData(data: IResourceCacheData<T>): IResourceCacheData<T> {
        const outerEntries = this.replacedEntries;

        this.replacedEntries = this.data.entries;
        try {
            return super.setData(data);
        } finally {
            this.replacedEntries = outerEntries;
        }
    }

    /** Keep replacement bookkeeping current before setData delivers synchronously. */
    protected didSetData(): void {
        const keys = Object.keys(this.data.entries);

        this.eviction.replace(keys);
        this.viewCache.forEach((_view: IResourceView<T>, key: string) => {
            if (!Object.prototype.hasOwnProperty.call(this.data.entries, key)) {
                this.viewCache.delete(key);
            }
        });
        for (const key of this.failures.keys()) {
            if (!Object.prototype.hasOwnProperty.call(this.data.entries, key)
                || this.replacedEntries?.[key] !== this.data.entries[key]) {
                this.failures.delete(key);
            }
        }
    }

    /** Reconcile only failures whose error/status paths changed, before subscribers run. */
    protected preEmit(): void {
        if (this.failures.size === 0 || (this.writes.size === 0 && this.draftTouched)) {
            return;
        }

        if (this.writes.size === 0 || this.writes.has(WILDCARD_PATH) || this.writes.has('entries')) {
            this.failures.forEach(this.reconcileFailure, this);
        } else {
            this.writes.forEach(this.reconcileFailureWrite, this);
        }
    }

    /**
     * Check one raw rejection against the serializable answer being published.
     *
     * @param failure - the request's recorded raw rejection and wire description
     * @param key - the owning cache key
     */
    private reconcileFailure(failure: {value: unknown; error: string; status: EResourceStatus}, key: string): void {
        const entry = this.data.entries[key];
        // A retry temporarily hides the old Error; abort can leave its raw failure available.
        if (entry && failure.status === EResourceStatus.Error && entry.error === undefined
            && ((entry.status === EResourceStatus.Pending && this.requests.has(key))
                || (entry.status === EResourceStatus.Idle && entry.failed))) {
            return;
        }

        if (!entry || entry.status !== failure.status || entry.error !== failure.error) {
            this.failures.delete(key);
        }
    }

    /**
     * Resolve a precise write to its owner without scanning unrelated failures.
     *
     * @param path - the recorded changed path
     */
    private reconcileFailureWrite(path: TPath): void {
        if (!path.startsWith(ENTRY_PATH_PREFIX)) {
            return;
        }

        const end = path.indexOf(PATH_SEPARATOR, ENTRY_PATH_PREFIX.length);
        if (end !== -1) {
            const field = path.slice(end + 1);
            if (field !== 'status' && field !== 'error') {
                return;
            }
        }

        const escaped = path.slice(ENTRY_PATH_PREFIX.length, end === -1 ? undefined : end);
        const key = escaped.includes('~')
            ? escaped.replace(/~1/g, PATH_SEPARATOR).replace(/~0/g, '~')
            : escaped;
        const failure = this.failures.get(key);

        if (failure) {
            this.reconcileFailure(failure, key);
        }
    }

    /**
     * The key an argument set is stored under, memoized while both reference and JSON are unchanged.
     *
     * @param args - the loader arguments to derive the key from
     */
    public keyOf(args: TArgs): string {
        const json = JSON.stringify(args === undefined ? null : args) as string;
        const memoized = this.lastKeyArgs === args && this.lastKeyValue !== undefined;

        if (memoized && this.lastKeyJson === json && this.lastKeyValue !== undefined) {
            return this.lastKeyValue;
        }

        const key = escapeCacheKey(json);
        const development = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';

        if (memoized && development && !this.keyMutationReported) {
            this.keyMutationReported = true;

            diagnostics.report(
                'a resource arguments object was mutated after its key was taken: the same reference now ' +
                `encodes to a different entry (${this.lastKeyValue} became ${key}), and the new key is the ` +
                'one being used. Build a fresh object per query rather than mutating one in place.'
            );
        }

        this.lastKeyArgs = args;
        this.lastKeyJson = json;
        this.lastKeyValue = key;

        return key;
    }

    /**
     * The read path of one entry, built with the same path segment escaping as store writes.
     *
     * @param args - the loader arguments identifying the entry
     */
    public pathOf(args: TArgs): TPath {
        return this.pathOfKey(this.keyOf(args));
    }

    /**
     * The read path for an already-resolved key, so a caller holding one need not re-derive it.
     *
     * @param key - the resolved cache key
     */
    public pathOfKey(key: string): TPath {
        return joinPath('entries', key);
    }

    /**
     * The entry as it stands, with the freshness verdict computed now.
     *
     * @param args - the loader arguments identifying the entry
     */
    public getEntry(args: TArgs): IResourceView<T> {
        return this.getEntryByKey(this.keyOf(args));
    }

    /**
     * The entry for an already-resolved key, so a caller holding one need not re-derive it.
     *
     * @param key - the resolved cache key
     */
    public getEntryByKey(key: string): IResourceView<T> {
        const stored = this.data.entries[key];

        if (!stored) {
            return ABSENT_VIEW as IResourceView<T>;
        }

        this.touch(key);

        const stale = this.isStale(stored);
        const cached = this.viewCache.get(key);

        if (cached && isViewCurrent(cached, stored, stale)) {
            return cached;
        }

        const view: IResourceView<T> = {...stored, stale};

        this.viewCache.set(key, view);

        return view;
    }

    /**
     * Hydration goes through restore(), not the base fromJSON's adopt-and-diff shortcut: only
     * restore() clears in-flight requests and normalizes a restored Pending status.
     *
     * @param value - the serialized snapshot; the cast is the caller's promise about the shape
     */
    public fromJSON(value: unknown): void {
        this.restore(value as IResourceCacheData<T>);
    }

    /**
     * Resolves one argument set to its key, read path and current view in one call — the
     * `IResourceSource` contract `useResource` needs (R16-10(4)), replacing the keyOf/pathOfKey/
     * getEntryByKey trio it used to call separately.
     *
     * Serializes `args` exactly once: `keyOf` is called a single time here, instead of once per
     * member of the old trio.
     *
     * @param args - the loader arguments identifying the entry
     */
    public resolve(args: TArgs): IResourceResolution<T> {
        const key = this.keyOf(args);

        // A fresh record: resolve() is public, and a shared scratch object would alias results.
        return {key, path: this.pathOfKey(key), view: this.getEntryByKey(key)};
    }

    /**
     * The raw rejection for one entry, which `error` can only describe.
     *
     * @param args - the loader arguments identifying the entry
     */
    public getFailure(args: TArgs): unknown {
        return this.failures.get(this.keyOf(args))?.value;
    }
}
