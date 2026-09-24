import { IResourceCacheOptions, IResourceView, TResourceLoader } from "../../Models/Resource.js";
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
export declare class ResourceCache<T, TArgs = void> extends ResourceCacheLifecycle<T, TArgs> {
    /** Most recently keyed arguments. */
    protected lastKeyArgs: TArgs | undefined;
    /** Serialized value of the most recently keyed arguments. */
    protected lastKeyJson: string | undefined;
    /** Cache key derived from the most recently keyed arguments. */
    protected lastKeyValue: string | undefined;
    /** Whether the mutable-arguments diagnostic was already reported. */
    protected keyMutationReported: boolean;
    /** Create a keyed cache for a resource loader.
     * @param loader - Function that loads a resource.
     * @param options - Cache and scheduler settings.
     */
    constructor(loader: TResourceLoader<T, TArgs>, options?: IResourceCacheOptions);
    /** The key an argument set is stored under, memoized while both reference and JSON are unchanged. */
    keyOf: (args: TArgs) => string;
    /** The read path of one entry, built with the same path segment escaping as store writes. */
    pathOf: (args: TArgs) => TPath;
    /** The entry as it stands, with the freshness verdict computed now. */
    getEntry: (args: TArgs) => IResourceView<T>;
    /** The raw rejection for one entry, which `error` can only describe. */
    getFailure: (args: TArgs) => unknown;
}
