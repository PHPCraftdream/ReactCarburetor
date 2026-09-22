import { IResourceCacheData, IResourceCacheOptions, IResourceEntry, IResourceView, TResourceLoader } from "../../Models/Resource.mjs";
import { TPath } from "../../Models/Paths.mjs";
import { Carburetor } from "../../Store/Carburetor.mjs";
/**
 * Many async answers, keyed by the arguments that produced them.
 *
 * `ResourceCarburetor` holds one slot, so loading with different arguments throws the previous answer
 * away. This holds an entry per argument set, each with its own status and freshness, which is the
 * shape an API layer needs — and the reason a consumer does not have to add a query library next to
 * the state engine.
 *
 * Entries live in a flat dictionary under keys from `encodeCacheKey`, so path tracking does the
 * precision for free: a component reading one entry is not woken by another entry's answer. See
 * docs/promise-cache.md for the decisions behind the shape, the escaped key and the TTL.
 */
export declare class ResourceCache<T, TArgs = void> extends Carburetor<IResourceCacheData<T>> {
    protected loader: TResourceLoader<T, TArgs>;
    /** How long an entry stays fresh, in milliseconds; judged at read time, `Infinity` meaning never stale. */
    protected ttl: number;
    /** The entry count eviction keeps the cache under, dropping least-recently-used entries past it. */
    protected maxEntries: number;
    /** In-flight requests, one per key: a second caller with the same arguments joins this promise. */
    protected requests: Map<string, Promise<void>>;
    /** The abort handle for each of those requests, fired by abort and compared against when an answer lands. */
    protected controllers: Map<string, AbortController>;
    /** The raw rejection values, which the serializable state cannot carry. */
    protected failures: Map<string, unknown>;
    /**
     * Use order per entry, for eviction. Bookkeeping, so it stays out of the state.
     *
     * A counter rather than a timestamp: `Date.now()` has millisecond resolution, so several reads in
     * one millisecond compare equal and "least recently used" stops being defined — which made
     * eviction drop the entry that had just been touched.
     */
    protected lastUsed: Map<string, number>;
    /** The counter those stamps come from; monotonic, so same-millisecond touches still order. */
    protected useTick: number;
    /**
     * The last view handed out per entry, so repeated reads share one object.
     *
     * A fresh view object on every read would defeat a child's `shallowEqual` props gate: the
     * entry behind it may be identical, but the prop identity is not, and the child re-renders
     * for nothing. Reused only while the stored entry still matches the view field for field —
     * entries are written in place through the draft proxy, so a changed entry keeps its object
     * identity and only its fields tell the truth.
     */
    protected viewCache: Map<string, IResourceView<T>>;
    /**
     * Takes the loader every entry is filled by, plus the lifetime and size bounds.
     *
     * @param loader - run once per distinct argument set, receiving an abort signal it should pass
     * to its fetch; a joiner never reaches it
     * @param options - the ttl and maxEntries overrides; either left undefined takes its default,
     * so `{}` is the entirely default cache
     */
    constructor(loader: TResourceLoader<T, TArgs>, options?: IResourceCacheOptions);
    /** Records that an entry was asked for, which is what eviction orders by. */
    protected touch: (key: string) => void;
    /** The arguments the most recent `keyOf` encoded, paired with the key below. */
    protected lastKeyArgs: TArgs | undefined;
    /** The key those arguments produced; a hit requires both slots to agree. */
    protected lastKeyValue: string | undefined;
    /**
     * The key an argument set is stored under, exposed so a caller can read one entry's path.
     *
     * Memoized on the most recent arguments, by reference: `useResource` asks for `pathOf(args)`
     * and then `getEntry(args)` within one render, and encoding the same object twice per render
     * is pure waste. A different reference recomputes, so the memo never answers with another
     * argument set's key. The one answer it can get wrong is a caller mutating an args object in
     * place between calls, which reads as the previous key — arguments here are value keys and
     * are expected to stay immutable once built.
     */
    keyOf: (args: TArgs) => string;
    /**
     * The read path of one entry.
     *
     * The component layer asks for this rather than building `entries.<key>` itself: where entries
     * live is this class's business, and a component that hard-coded it would break the moment the
     * shape changed.
     *
     * The segment is built by `joinPath`, the same builder the tracking proxies use, rather than
     * concatenating the stored key by hand: the stored key is already escaped once by
     * `encodeCacheKey`, and as a path segment it is escaped again, so what a reader subscribes to
     * is exactly the path a write through the draft proxy records. Hand-appending the stored key
     * made the two disagree for any key holding `.` or `~`, and those entries never notified.
     */
    pathOf: (args: TArgs) => TPath;
    /**
     * The entry as it stands, with the freshness verdict computed now.
     *
     * Deliberately does not start a request: a read during render that wrote to the store would
     * notify subscribers mid-render. Refreshing a stale entry is the caller's move, from an effect.
     */
    getEntry: (args: TArgs) => IResourceView<T>;
    /** The raw rejection for one entry, which `error` can only describe. */
    getFailure: (args: TArgs) => unknown;
    /**
     * Resolves from the cache while the entry is fresh, and fetches otherwise.
     *
     * Concurrent callers with the same arguments share one request. Different arguments are
     * independent — unlike a single-slot resource, one does not abort the other.
     */
    load: (args: TArgs) => Promise<void>;
    /**
     * Fetches regardless of freshness, and keeps the previous answer if the fetch fails.
     *
     * This is the call behind a refresh button: the entry may be perfectly fresh and the user still
     * wants the current truth. A refresh running next to a `load` of the same arguments joins it
     * rather than starting a second request — the network is already being asked the same question.
     */
    refresh: (args: TArgs) => Promise<void>;
    /** Cancels the request for one entry. */
    abort: (args: TArgs) => void;
    /**
     * Cancels every request in flight.
     *
     * Separate from `abort(args)` rather than an optional argument: a resource whose arguments are
     * `void` is loaded as `load()`, so `abort()` would be genuinely ambiguous between "this one
     * entry" and "all of them".
     */
    abortAll: () => void;
    /**
     * Marks one entry stale without touching its data.
     *
     * Deliberately does not refetch. After a mutation, a cache may hold a hundred entries while two
     * are on screen; refetching all of them is the waste this engine exists to avoid. The entries
     * being read refetch themselves on the next render, and a caller who wants one *now* calls
     * `refresh`.
     *
     * Invalidating also clears `failed`, re-arming an entry whose last attempt failed: the
     * invalidation is a new external event, not the failure's own notification, so the next
     * render may fetch again — which is what lets a post-write invalidation retry a refresh
     * that had failed.
     */
    invalidate: (args: TArgs) => void;
    /** Marks every entry stale and re-arms any failed entry, the usual move after a write the server accepted. */
    invalidateAll: () => void;
    /** Drops one entry, cancelling its request first so a late answer cannot resurrect it. */
    forget: (args: TArgs) => void;
    /** Drops every entry. */
    forgetAll: () => void;
    /** Removes one entry completely: request, failure, use order, last view and the data itself. */
    protected forgetKey: (key: string) => void;
    /** Whether an entry has expired or was invalidated; an empty one is always stale. */
    protected isStale: (entry: IResourceEntry<T>) => boolean;
    /**
     * Whether a cached view still describes the entry exactly, staleness included.
     *
     * @param view - the view last handed out for this key, whose fields are the earlier snapshot
     * @param entry - the stored entry as it stands now, compared field by field
     * @param stale - the freshness verdict computed for this call, which time alone can flip
     */
    protected isViewCurrent: (view: IResourceView<T>, entry: IResourceEntry<T>, stale: boolean) => boolean;
    /**
     * Whether a component is reading this entry right now.
     *
     * Subscriber read paths are the only honest answer available, and they are exactly what the
     * engine already tracks. A subscriber with no read set — devtools, persistence — is deliberately
     * not counted: it watches everything, and counting it would pin the whole cache in memory.
     */
    protected isRetained: (key: string) => boolean;
    /**
     * Keeps the cache within its bound, dropping the least recently used entries first.
     *
     * Without this the cache grows by one entry per distinct argument set for the lifetime of the
     * process. An entry with a request in flight, or one a component is reading, is never dropped:
     * the first would leave a promise with nowhere to land, the second would blank out the screen.
     *
     * The check runs wherever eligibility can change: a request starting and one settling, the
     * latter also being what eventually reclaims the bound once a reader unsubscribes.
     *
     * @param deferNotification - true when the caller is mid-render: the drop goes out through
     * emitSoon() rather than emitUpdate(), like markLoading()'s own deferred write
     */
    protected evict: (deferNotification?: boolean) => void;
    /** Cancels the request for one key, leaving whatever data the entry already holds. */
    protected abortKey: (key: string) => void;
    /**
     * Reads for Suspense: returns the answer, or throws what React should wait for.
     *
     * Called during render, so the request it starts publishes on the next microtask instead of
     * immediately — notifying subscribers mid-render is exactly the hazard the rules report.
     */
    suspend: (args: TArgs) => T;
    /**
     * Starts a request, or joins the one already in flight for this key.
     *
     * @param key - the escaped form keyOf() produces, so an argument holding a dot cannot
     * masquerade as another entry's path prefix
     * @param args - handed to the loader only on a fresh start; a joiner's arguments are not
     * consulted, the key having already matched
     * @param deferNotification - true from suspend(), so the pending-status write goes out on a
     * microtask instead of mid-render
     */
    protected fetch: (key: string, args: TArgs, deferNotification?: boolean) => Promise<void>;
    /**
     * Moves an entry into its loading state.
     *
     * An entry that already has data stays `Success` and only raises `refreshing`: replacing it with
     * `Pending` would blank out data the user is currently reading.
     *
     * @param key - selects the entry to move; one the store does not have yet is created here,
     * which is how a fresh key first appears in the state
     * @param deferNotification - true when the caller is mid-render: the write goes out through
     * emitSoon() rather than emitUpdate()
     */
    protected markLoading: (key: string, deferNotification: boolean) => void;
    /**
     * Whether this request is still the one the entry is waiting for.
     *
     * @param key - picks the controllers slot a newer request would have overwritten
     * @param controller - the handle the caller started with; a later request for the key has
     * already taken the slot, and an aborted one fails the signal half of the check
     */
    protected isCurrent: (key: string, controller: AbortController) => boolean;
    /**
     * Stores an answer, unless the entry is gone or a newer request has taken over.
     *
     * @param key - the entry written to, whose request, controller and failure records are cleared
     * alongside it
     * @param controller - the request claiming the write; anything but the currently registered one
     * fails the check and its answer is discarded
     * @param data - stored untouched as the answer; landing it also stamps freshness and clears the
     * failed and invalidated flags
     */
    protected settleSuccess: (key: string, controller: AbortController, data: T) => void;
    /**
     * Records a failure without destroying a good answer.
     *
     * A refresh that fails leaves the entry `Success` with its previous data and an error beside it,
     * so an interface can show both. Only an entry that never succeeded becomes `Error`.
     *
     * `updatedAt` is deliberately left alone: it records when the *data* was obtained, and a failure
     * did not obtain any. Bumping it would both lie about the data's age and suppress the next
     * attempt for a whole TTL.
     *
     * The `failed` flag is what stops the component layer from auto-retrying a failed refresh that
     * keeps `status: Success`. `invalidated` is deliberately left alone, so staleness keeps
     * reporting the truth about the data's age for display, while `failed` alone governs auto-retry.
     *
     * @param key - the entry taking the failure; the raw value is filed under it in failures,
     * because the serializable state can only carry the described message
     * @param controller - the request reporting it; a superseded or aborted one changes nothing,
     * leaving whichever request is current in charge of the outcome
     * @param error - the rejection as it was thrown, kept whole for `suspend` to rethrow rather
     * than flattened to a string here
     */
    protected settleFailure: (key: string, controller: AbortController, error: unknown) => void;
}
