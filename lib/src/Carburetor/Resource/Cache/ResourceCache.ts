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
import {getInitialCacheEntry} from "./State/getInitialCacheEntry";
import {ResourceCacheLifecycle} from "./ResourceCacheLifecycle";
import {isViewCurrent} from "./State/isViewCurrent";
import {trimCacheRuntime} from "./State/Runtime/Registry";

declare const process: {env: {NODE_ENV?: string}} | undefined;

// Every absent entry answers with the exact same shape regardless of T (data is always
// undefined), so one frozen instance serves every miss instead of a fresh object per call.
// Nothing ever mutates a view (see IResourceView's callers) or caches this one in viewCache,
// so sharing it across keys and across ResourceCache instances is safe.
const ABSENT_VIEW: IResourceView<unknown> = Object.freeze({...getInitialCacheEntry<unknown>(), stale: true});
const ENTRY_PATH_PREFIX = `entries${PATH_SEPARATOR}`;
const DEFAULT_KEY_CACHE_SIZE = 4096;

/** Arguments a key can be derived from without serialization: a primitive value encodes to itself. */
type TPrimitiveArgs = string | number | boolean | null | undefined;

/** One Map-owned key/path record with intrusive links, avoiding a separate LRU node. */
interface IPrimedKey {
    key: string;
    path: TPath;
    argument: TPrimitiveArgs;
    previous: IPrimedKey | undefined;
    next: IPrimedKey | undefined;
}

const validateOptions = (options: IResourceCacheOptions): IResourceCacheOptions => {
    if (options.ttl !== undefined && (Number.isNaN(options.ttl) || options.ttl < 0)) {
        throw new RangeError('ResourceCache ttl must be a non-negative number');
    }

    if (options.maxEntries !== undefined && options.maxEntries !== Infinity
        && (!Number.isInteger(options.maxEntries) || options.maxEntries < 0)) {
        throw new RangeError('ResourceCache maxEntries must be a non-negative integer or Infinity');
    }
    if (options.keyCacheSize !== undefined &&
        (!Number.isSafeInteger(options.keyCacheSize) || options.keyCacheSize < 0)) {
        throw new RangeError('ResourceCache keyCacheSize must be a non-negative safe integer');
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
    /** Primitive key/path records also form the intrusive least-recently-used list. */
    private primedKeys: Map<TPrimitiveArgs, IPrimedKey> | undefined = undefined;
    /** Least-recent and most-recent retained records. */
    private primedHead: IPrimedKey | undefined = undefined;
    /** Most-recent retained record. */
    private primedTail: IPrimedKey | undefined = undefined;
    /** Record-count budget; each memo record also carries its two intrusive LRU links. */
    private readonly keyCacheSize: number;

    /** Create a keyed cache for a resource loader.
     *
     * @param loader - Function that loads a resource.
     * @param options - Cache settings, including the primitive key memo budget.
     */
    constructor(loader: TResourceLoader<T, TArgs>, options: IResourceCacheOptions = {}) {
        super(loader, validateOptions(options));
        this.keyCacheSize = options.keyCacheSize === undefined ? DEFAULT_KEY_CACHE_SIZE : options.keyCacheSize;
    }

    /** Keep replacement bookkeeping current before the shared boundary publishes. */
    protected didSetData(): void {
        const keys = Object.keys(this.data.entries);
        this.runtimeRecords?.forEach((_runtime, key) => this.reconcileFailure(key));
        this.eviction.replace(keys);
        this.viewCache.forEach((_view: IResourceView<T>, key: string) => {
            if (!Object.prototype.hasOwnProperty.call(this.data.entries, key)) {
                this.viewCache.delete(key);
            }
        });
    }

    /** Reconcile only live raw-answer owners affected by this completed write. */
    protected preEmit(): void {
        if (!this.runtimeRecords || this.runtimeRecords.size === 0 ||
            (this.writes.size === 0 && this.draftTouched)) return;
        if (this.writes.size === 0 || this.writes.has(WILDCARD_PATH) || this.writes.has('entries')) {
            this.runtimeRecords.forEach((_runtime, key) => this.reconcileFailure(key));
        } else {
            this.writes.forEach(this.reconcileFailureWrite, this);
        }
    }

    /** Preserve raw rejection only while its exact entry and wire answer remain authoritative.
     *
     * @param key - encoded cache key whose answer is reconciled.
     */
    private reconcileFailure(key: string): void {
        const runtime = this.runtimeFor(key);
        const answer = runtime?.answer;
        const failure = answer?.failure;
        if (!runtime || !answer || !failure) return;
        const entry = this.data.entries[key];
        if (entry === answer.entry && failure.status === EResourceStatus.Error && entry.error === undefined
            && ((entry.status === EResourceStatus.Pending && runtime.request !== undefined)
                || (entry.status === EResourceStatus.Idle && entry.failed))) return;
        if (!entry || entry !== answer.entry || entry.status !== failure.status || entry.error !== failure.message) {
            answer.failure = undefined;
            this.runtimeRecords = trimCacheRuntime(this.runtimeRecords, key, runtime);
        }
    }

    /** Resolve one precise write to its entry without scanning unrelated runtime owners.
     *
     * @param path - changed store path.
     */
    private reconcileFailureWrite(path: TPath): void {
        if (!path.startsWith(ENTRY_PATH_PREFIX)) return;
        const end = path.indexOf(PATH_SEPARATOR, ENTRY_PATH_PREFIX.length);
        const escaped = path.slice(ENTRY_PATH_PREFIX.length, end === -1 ? undefined : end);
        const key = escaped.includes('~')
            ? escaped.replace(/~1/g, PATH_SEPARATOR).replace(/~0/g, '~')
            : escaped;
        this.reconcileFailure(key);
    }

    /** Cached key and path for primitive argument sets, avoiding stringify, escape and concat.
     *
     * The first occurrence computes through the ordinary keyOf derivation, so the cached key is
     * byte-identical to what keyOf would return; repeats answer from the map. The bounded LRU
     * evicts only its least-recently-used record on a miss. Object arguments return undefined and
     * keep the memoized mutation check.
     *
     * @param args - the loader arguments to derive the key from
     */
    private primed(args: TArgs): {key: string; path: TPath} | undefined {
        if (args !== null && args !== undefined && typeof args !== 'string' && typeof args !== 'number'
            && typeof args !== 'boolean') return undefined;

        const primitive = args as TPrimitiveArgs;
        const records = this.primedKeys;
        const cached = records?.get(primitive);

        if (cached !== undefined) {
            if (this.primedTail !== cached) this.touchPrimed(cached);
            return cached;
        }

        const key = escapeCacheKey(JSON.stringify(args === undefined ? null : args) as string);
        const path = joinPath('entries', key);
        if (this.keyCacheSize === 0) {
            return {key, path};
        }

        const retained = this.primedKeys ??= new Map<TPrimitiveArgs, IPrimedKey>();
        if (retained.size >= this.keyCacheSize) {
            const oldest = this.primedHead;
            if (oldest === undefined) throw new Error('ResourceCache: primitive key LRU list is empty');

            this.primedHead = oldest.next;
            if (this.primedHead === undefined) this.primedTail = undefined;
            else this.primedHead.previous = undefined;
            retained.delete(oldest.argument);
        }

        const primed: IPrimedKey = {
            key, path, argument: primitive, previous: this.primedTail, next: undefined,
        };
        retained.set(primitive, primed);
        if (this.primedTail === undefined) this.primedHead = primed;
        else this.primedTail.next = primed;
        this.primedTail = primed;

        return primed;
    }

    /** Move a retained non-tail record without changing the lookup Map.
     *
     * @param primed - retained record to promote.
     */
    private touchPrimed(primed: IPrimedKey): void {
        const tail = this.primedTail;

        const previous = primed.previous;
        const next = primed.next;
        if (previous === undefined) this.primedHead = next;
        else previous.next = next;
        if (next !== undefined) next.previous = previous;

        primed.previous = tail;
        primed.next = undefined;
        if (tail === undefined) this.primedHead = primed;
        else tail.next = primed;
        this.primedTail = primed;
    }

    /**
     * The key an argument set is stored under, memoized while both reference and JSON are unchanged.
     *
     * @param args - the loader arguments to derive the key from
     */
    protected keyOf(args: TArgs): string {
        const primed = this.primed(args);

        if (primed !== undefined) return primed.key;

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
    protected pathOf(args: TArgs): TPath {
        const primed = this.primed(args);

        return primed ? primed.path : this.pathOfKey(this.keyOf(args));
    }

    /**
     * The read path for an already-resolved key, so a caller holding one need not re-derive it.
     *
     * @param key - the resolved cache key
     */
    protected pathOfKey(key: string): TPath {
        return joinPath('entries', key);
    }

    /**
     * The entry as it stands, with the freshness verdict computed now.
     *
     * @param args - the loader arguments identifying the entry
     */
    public getEntry(args: TArgs): IResourceView<T> {
        const primed = this.primed(args);

        return this.getEntryByKey(primed ? primed.key : this.keyOf(args));
    }

    /**
     * The entry for an already-resolved key, so a caller holding one need not re-derive it.
     *
     * @param key - the resolved cache key
     */
    protected getEntryByKey(key: string): IResourceView<T> {
        const stored = this.data.entries[key];

        if (!stored) {
            return ABSENT_VIEW as IResourceView<T>;
        }

        // LRU bookkeeping only matters when a bound can actually evict; Infinity keeps no order.
        if (this.maxEntries !== Infinity) {
            this.touch(key);
        }

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
        const primed = this.primed(args);

        const key = primed !== undefined ? primed.key : this.keyOf(args);
        const path = primed !== undefined ? primed.path : this.pathOfKey(key);
        const view = this.getEntryByKey(key);

        // Only component readers request this facade. Public resolve().view/getEntry stay plain,
        // and each facade captures this resolution's snapshot rather than becoming a live view.
        return {
            key, path, view, present: this.data.entries[key] !== undefined,
            fieldView: (record): IResourceView<T> => {
                const fields = {...view};
                for (const field of Object.keys(fields) as Array<keyof IResourceView<T>>) {
                    Object.defineProperty(fields, field, {
                        enumerable: true,
                        configurable: true,
                        get: () => {
                            if (field === 'stale') {
                                // isStale depends on these fields; time itself has no write path.
                                record(joinPath(path, 'invalidated'));
                                record(joinPath(path, 'updatedAt'));
                            } else {
                                record(joinPath(path, field));
                                if (field === 'refreshing') record(joinPath(path, 'updatedAt'));
                            }
                            return view[field];
                        },
                        set: (value: IResourceView<T>[keyof IResourceView<T>]) => {
                            Object.defineProperty(fields, field, {
                                value, writable: true, enumerable: true, configurable: true,
                            });
                        },
                    });
                }
                return fields;
            },
        };
    }

    /**
     * The raw rejection for one entry, which `error` can only describe.
     *
     * @param args - the loader arguments identifying the entry
     */
    public getFailure(args: TArgs): unknown {
        const key = this.keyOf(args);
        const runtime = this.runtimeFor(key);
        const answer = runtime?.answer;
        if (answer && answer.entry !== this.data.entries[key]) {
            runtime.answer = undefined;
            this.runtimeRecords = trimCacheRuntime(this.runtimeRecords, key, runtime);
            return undefined;
        }
        return answer?.failure?.value;
    }
}
