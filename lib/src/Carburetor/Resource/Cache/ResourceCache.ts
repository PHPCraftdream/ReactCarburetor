import {
    IResourceCacheOptions,
    IResourceView,
    TResourceLoader,
} from "@/Carburetor/Models/Resource";
import {TPath} from "@/Carburetor/Models/Paths";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {escapeCacheKey} from "./escapeCacheKey";
import {getInitialCacheEntry} from "./getInitialCacheEntry";
import {ResourceCacheLifecycle} from "./ResourceCacheLifecycle";

declare const process: {env: {NODE_ENV?: string}} | undefined;

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
export class ResourceCache<T, TArgs = void> extends ResourceCacheLifecycle<T, TArgs> {
    /** Most recently keyed arguments. */
    protected lastKeyArgs: TArgs | undefined = undefined;
    /** Serialized value of the most recently keyed arguments. */
    protected lastKeyJson: string | undefined = undefined;
    /** Cache key derived from the most recently keyed arguments. */
    protected lastKeyValue: string | undefined = undefined;
    /** Whether the mutable-arguments diagnostic was already reported. */
    protected keyMutationReported: boolean = false;

    /** Create a keyed cache for a resource loader.
     * @param loader - Function that loads a resource.
     * @param options - Cache and scheduler settings.
     */
    constructor(loader: TResourceLoader<T, TArgs>, options: IResourceCacheOptions = {}) {
        super(loader, options);
    }

    /** The key an argument set is stored under, memoized while both reference and JSON are unchanged. */
    public keyOf = (args: TArgs): string => {
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
    };

    /** The read path of one entry, built with the same path segment escaping as store writes. */
    public pathOf = (args: TArgs): TPath => {
        return joinPath('entries', this.keyOf(args));
    };

    /** The entry as it stands, with the freshness verdict computed now. */
    public getEntry = (args: TArgs): IResourceView<T> => {
        const key = this.keyOf(args);
        const stored = this.data.entries[key];

        if (!stored) {
            return {...getInitialCacheEntry<T>(), stale: true};
        }

        this.touch(key);

        const stale = this.isStale(stored);
        const cached = this.viewCache.get(key);

        if (cached && this.isViewCurrent(cached, stored, stale)) {
            return cached;
        }

        const view: IResourceView<T> = {...stored, stale};

        this.viewCache.set(key, view);

        return view;
    };

    /** The raw rejection for one entry, which `error` can only describe. */
    public getFailure = (args: TArgs): unknown => {
        return this.failures.get(this.keyOf(args));
    };
}
