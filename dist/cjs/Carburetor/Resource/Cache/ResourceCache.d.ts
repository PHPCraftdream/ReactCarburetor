import { IResourceCacheOptions, IResourceResolution, IResourceSource, IResourceView, TResourceLoader } from "../../Models/Resource.js";
import { TPath } from "../../Models/Paths.js";
import { ResourceCacheLifecycle } from "./ResourceCacheLifecycle.js";
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
export declare class ResourceCache<T, TArgs = void> extends ResourceCacheLifecycle<T, TArgs> implements IResourceSource<T, TArgs> {
    /** Most recently keyed arguments. */
    protected lastKeyArgs: TArgs | undefined;
    /** Serialized value of the most recently keyed arguments. */
    protected lastKeyJson: string | undefined;
    /** Cache key derived from the most recently keyed arguments. */
    protected lastKeyValue: string | undefined;
    /** Whether the mutable-arguments diagnostic was already reported. */
    protected keyMutationReported: boolean;
    /** Create a keyed cache for a resource loader.
     *
     * @param loader - Function that loads a resource.
     * @param options - Cache and scheduler settings.
     */
    constructor(loader: TResourceLoader<T, TArgs>, options?: IResourceCacheOptions);
    /**
     * The key an argument set is stored under, memoized while both reference and JSON are unchanged.
     *
     * @param args - the loader arguments to derive the key from
     */
    keyOf(args: TArgs): string;
    /**
     * The read path of one entry, built with the same path segment escaping as store writes.
     *
     * @param args - the loader arguments identifying the entry
     */
    pathOf(args: TArgs): TPath;
    /**
     * The read path for an already-resolved key, so a caller holding one need not re-derive it.
     *
     * @param key - the resolved cache key
     */
    pathOfKey(key: string): TPath;
    /**
     * The entry as it stands, with the freshness verdict computed now.
     *
     * @param args - the loader arguments identifying the entry
     */
    getEntry(args: TArgs): IResourceView<T>;
    /**
     * The entry for an already-resolved key, so a caller holding one need not re-derive it.
     *
     * @param key - the resolved cache key
     */
    getEntryByKey(key: string): IResourceView<T>;
    /**
     * Hydration goes through restore(), not the base fromJSON's adopt-and-diff shortcut: only
     * restore() clears in-flight requests and normalizes a restored Pending status.
     *
     * @param value - the serialized snapshot; the cast is the caller's promise about the shape
     */
    fromJSON(value: unknown): void;
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
    resolve(args: TArgs): IResourceResolution<T>;
    /**
     * The raw rejection for one entry, which `error` can only describe.
     *
     * @param args - the loader arguments identifying the entry
     */
    getFailure(args: TArgs): unknown;
}
