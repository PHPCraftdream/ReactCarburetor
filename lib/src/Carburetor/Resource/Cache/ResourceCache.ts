import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {
    IResourceCacheData,
    IResourceCacheOptions,
    IResourceEntry,
    IResourceView,
    TResourceLoader,
} from "@/Carburetor/Models/Resource";
import {TPath} from "@/Carburetor/Models/Paths";
import {Carburetor} from "@/Carburetor/Store/Carburetor";
import {PATH_SEPARATOR} from "@/Carburetor/Store/Paths/PathSeparator";
import {describeError} from "@/Carburetor/Resource/describeError";
import {encodeCacheKey} from "./encodeCacheKey";
import {getInitialCacheEntry} from "./getInitialCacheEntry";

/** Long enough that a screen's worth of reads shares one request, short enough to feel live. */
const DEFAULT_TTL: number = 30_000;
const DEFAULT_MAX_ENTRIES: number = 100;

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
export class ResourceCache<T, TArgs = void> extends Carburetor<IResourceCacheData<T>> {
    /** How long an entry stays fresh, in milliseconds; judged at read time, `Infinity` meaning never stale. */
    protected ttl: number;
    /** The entry count eviction keeps the cache under, dropping least-recently-used entries past it. */
    protected maxEntries: number;

    /** In-flight requests, one per key: a second caller with the same arguments joins this promise. */
    protected requests: Map<string, Promise<void>> = new Map<string, Promise<void>>();
    /** The abort handle for each of those requests, fired by abort and compared against when an answer lands. */
    protected controllers: Map<string, AbortController> = new Map<string, AbortController>();

    /** The raw rejection values, which the serializable state cannot carry. */
    protected failures: Map<string, unknown> = new Map<string, unknown>();

    /**
     * Use order per entry, for eviction. Bookkeeping, so it stays out of the state.
     *
     * A counter rather than a timestamp: `Date.now()` has millisecond resolution, so several reads in
     * one millisecond compare equal and "least recently used" stops being defined — which made
     * eviction drop the entry that had just been touched.
     */
    protected lastUsed: Map<string, number> = new Map<string, number>();
    /** The counter those stamps come from; monotonic, so same-millisecond touches still order. */
    protected useTick: number = 0;

    /**
     * Takes the loader every entry is filled by, plus the lifetime and size bounds.
     *
     * @param loader - run once per distinct argument set, receiving an abort signal it should pass
     * to its fetch; a joiner never reaches it
     * @param options - the ttl and maxEntries overrides; either left undefined takes its default,
     * so `{}` is the entirely default cache
     */
    constructor(protected loader: TResourceLoader<T, TArgs>, options: IResourceCacheOptions = {}) {
        super({entries: {}}, options.scheduler);

        this.ttl = options.ttl === undefined ? DEFAULT_TTL : options.ttl;
        this.maxEntries = options.maxEntries === undefined ? DEFAULT_MAX_ENTRIES : options.maxEntries;
    }

    /** Records that an entry was asked for, which is what eviction orders by. */
    protected touch = (key: string): void => {
        this.useTick += 1;

        this.lastUsed.set(key, this.useTick);
    };

    /** The key an argument set is stored under, exposed so a caller can read one entry's path. */
    public keyOf = (args: TArgs): string => {
        return encodeCacheKey(args);
    };

    /**
     * The read path of one entry.
     *
     * The component layer asks for this rather than building `entries.<key>` itself: where entries
     * live is this class's business, and a component that hard-coded it would break the moment the
     * shape changed.
     */
    public pathOf = (args: TArgs): TPath => {
        return `entries${PATH_SEPARATOR}${this.keyOf(args)}`;
    };

    /**
     * The entry as it stands, with the freshness verdict computed now.
     *
     * Deliberately does not start a request: a read during render that wrote to the store would
     * notify subscribers mid-render. Refreshing a stale entry is the caller's move, from an effect.
     */
    public getEntry = (args: TArgs): IResourceView<T> => {
        const key = this.keyOf(args);
        const stored = this.data.entries[key];
        const entry = stored || getInitialCacheEntry<T>();

        // Only a real entry has a use order worth recording: eviction enumerates entries, so a
        // stamp on a key that was only ever read would never be reclaimed and would pile up.
        if (stored) {
            this.touch(key);
        }

        return {...entry, stale: this.isStale(entry)};
    };

    /** The raw rejection for one entry, which `error` can only describe. */
    public getFailure = (args: TArgs): unknown => {
        return this.failures.get(this.keyOf(args));
    };

    /**
     * Resolves from the cache while the entry is fresh, and fetches otherwise.
     *
     * Concurrent callers with the same arguments share one request. Different arguments are
     * independent — unlike a single-slot resource, one does not abort the other.
     */
    public load = (args: TArgs): Promise<void> => {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];

        this.touch(key);

        if (entry && entry.status === EResourceStatus.Success && !this.isStale(entry)) {
            return Promise.resolve();
        }

        return this.fetch(key, args);
    };

    /**
     * Fetches regardless of freshness, and keeps the previous answer if the fetch fails.
     *
     * This is the call behind a refresh button: the entry may be perfectly fresh and the user still
     * wants the current truth. A refresh running next to a `load` of the same arguments joins it
     * rather than starting a second request — the network is already being asked the same question.
     */
    public refresh = (args: TArgs): Promise<void> => {
        const key = this.keyOf(args);

        this.touch(key);

        return this.fetch(key, args);
    };

    /** Cancels the request for one entry. */
    public abort = (args: TArgs): void => {
        this.abortKey(this.keyOf(args));
    };

    /**
     * Cancels every request in flight.
     *
     * Separate from `abort(args)` rather than an optional argument: a resource whose arguments are
     * `void` is loaded as `load()`, so `abort()` would be genuinely ambiguous between "this one
     * entry" and "all of them".
     */
    public abortAll = (): void => {
        Array.from(this.controllers.keys()).forEach((key: string) => this.abortKey(key));
    };

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
    public invalidate = (args: TArgs): void => {
        const key = this.keyOf(args);

        if (!this.data.entries[key]) {
            return;
        }

        this.update((draft: IResourceCacheData<T>) => {
            draft.entries[key].invalidated = true;
            draft.entries[key].failed = false;
        });
    };

    /** Marks every entry stale and re-arms any failed entry, the usual move after a write the server accepted. */
    public invalidateAll = (): void => {
        const keys = Object.keys(this.data.entries);

        if (keys.length === 0) {
            return;
        }

        this.update((draft: IResourceCacheData<T>) => {
            keys.forEach((key: string) => {
                draft.entries[key].invalidated = true;
                draft.entries[key].failed = false;
            });
        });
    };

    /** Drops one entry, cancelling its request first so a late answer cannot resurrect it. */
    public forget = (args: TArgs): void => {
        this.forgetKey(this.keyOf(args));
    };

    /** Drops every entry. */
    public forgetAll = (): void => {
        Object.keys(this.data.entries).forEach((key: string) => this.forgetKey(key));
    };

    /** Removes one entry completely: request, failure, use order and the data itself. */
    protected forgetKey = (key: string): void => {
        this.abortKey(key);
        this.failures.delete(key);
        this.lastUsed.delete(key);

        if (!this.data.entries[key]) {
            return;
        }

        this.update((draft: IResourceCacheData<T>) => {
            delete draft.entries[key];
        });
    };

    /** Whether an entry has expired or was invalidated; an empty one is always stale. */
    protected isStale = (entry: IResourceEntry<T>): boolean => {
        if (entry.invalidated || entry.updatedAt === undefined) {
            return true;
        }

        return Date.now() - entry.updatedAt > this.ttl;
    };

    /**
     * Whether a component is reading this entry right now.
     *
     * Subscriber read paths are the only honest answer available, and they are exactly what the
     * engine already tracks. A subscriber with no read set — devtools, persistence — is deliberately
     * not counted: it watches everything, and counting it would pin the whole cache in memory.
     */
    protected isRetained = (key: string): boolean => {
        const prefix = `entries.${key}`;

        return Object.keys(this.subscribers).some((id: string) => {
            const reads = this.subscribers[id].reads;

            return Array.from(reads).some((read: TPath) => {
                return read === prefix || read.startsWith(`${prefix}${PATH_SEPARATOR}`);
            });
        });
    };

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
    protected evict = (deferNotification: boolean = false): void => {
        const keys = Object.keys(this.data.entries);

        if (keys.length <= this.maxEntries) {
            return;
        }

        const candidates = keys
            .filter((key: string) => !this.requests.has(key) && !this.isRetained(key))
            .sort((left: string, right: string) => {
                return (this.lastUsed.get(left) || 0) - (this.lastUsed.get(right) || 0);
            });

        const excess = keys.length - this.maxEntries;
        const doomed = candidates.slice(0, excess);

        if (doomed.length === 0) {
            return;
        }

        doomed.forEach((key: string) => {
            this.failures.delete(key);
            this.lastUsed.delete(key);
        });

        // Written through draft by hand, as markLoading() does: update() cannot hold its
        // notification back, and this is the one write that sometimes must be.
        const draft = this.draft;

        doomed.forEach((key: string) => {
            delete draft.entries[key];
        });

        if (deferNotification) {
            // markLoading() has already scheduled the deferred emit when it wrote the pending
            // status, so these deletes ride that same microtask; a second emitSoon() would publish
            // an empty write set, which goes out as a wake-everything wildcard.
            if (!this.pendingEmit) {
                this.emitSoon();
            }

            return;
        }

        this.emitUpdate();
    };

    /** Cancels the request for one key, leaving whatever data the entry already holds. */
    protected abortKey = (key: string): void => {
        const controller = this.controllers.get(key);

        if (!controller) {
            return;
        }

        controller.abort();
        this.controllers.delete(key);
        this.requests.delete(key);

        const entry = this.data.entries[key];

        // An entry left in Pending would claim forever that something is on its way.
        if (entry && entry.status === EResourceStatus.Pending) {
            this.update((draft: IResourceCacheData<T>) => {
                draft.entries[key].status = EResourceStatus.Idle;
            });

            return;
        }

        if (entry && entry.refreshing) {
            this.update((draft: IResourceCacheData<T>) => {
                draft.entries[key].refreshing = false;
            });
        }
    };

    /**
     * Reads for Suspense: returns the answer, or throws what React should wait for.
     *
     * Called during render, so the request it starts publishes on the next microtask instead of
     * immediately — notifying subscribers mid-render is exactly the hazard the rules report.
     */
    public suspend = (args: TArgs): T => {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];

        this.touch(key);

        if (entry && entry.status === EResourceStatus.Success && entry.data !== undefined) {
            return entry.data;
        }

        if (entry && entry.status === EResourceStatus.Error) {
            throw this.failures.get(key) || new Error(entry.error || 'Carburetor: resource failed');
        }

        const known = this.requests.get(key);

        throw known || this.fetch(key, args, true);
    };

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
    protected fetch = (key: string, args: TArgs, deferNotification: boolean = false): Promise<void> => {
        const known = this.requests.get(key);

        if (known) {
            return known;
        }

        const controller = new AbortController();

        this.controllers.set(key, controller);
        this.markLoading(key, deferNotification);

        // A loader may throw before returning its promise; routing the throw through the same
        // rejection path keeps the entry from waiting on a request that was never registered.
        let answer: Promise<T>;

        try {
            answer = this.loader(args, controller.signal);
        } catch (error: unknown) {
            answer = Promise.reject(error);
        }

        const request = answer.then(
            (data: T) => {
                this.settleSuccess(key, controller, data);
            },
            (error: unknown) => {
                this.settleFailure(key, controller, error);
            }
        );

        this.requests.set(key, request);

        // Enforced here rather than where the entry is created: only now is this request visible to
        // the eviction pass, which must never drop an entry that something is waiting for. The
        // deferral carries through: mid-render, the eviction publishes when the status write does.
        this.evict(deferNotification);

        return request;
    };

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
    protected markLoading = (key: string, deferNotification: boolean): void => {
        const entry = this.data.entries[key];
        const draft = this.draft;

        if (!entry) {
            draft.entries[key] = {...getInitialCacheEntry<T>(), status: EResourceStatus.Pending};
        } else if (entry.data === undefined) {
            draft.entries[key].status = EResourceStatus.Pending;
            draft.entries[key].error = undefined;
        } else {
            draft.entries[key].refreshing = true;
        }

        if (deferNotification) {
            this.emitSoon();

            return;
        }

        this.emitUpdate();
    };

    /**
     * Whether this request is still the one the entry is waiting for.
     *
     * @param key - picks the controllers slot a newer request would have overwritten
     * @param controller - the handle the caller started with; a later request for the key has
     * already taken the slot, and an aborted one fails the signal half of the check
     */
    protected isCurrent = (key: string, controller: AbortController): boolean => {
        return this.controllers.get(key) === controller && !controller.signal.aborted;
    };

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
    protected settleSuccess = (key: string, controller: AbortController, data: T): void => {
        if (!this.isCurrent(key, controller) || !this.data.entries[key]) {
            return;
        }

        this.controllers.delete(key);
        this.requests.delete(key);
        this.failures.delete(key);

        this.update((draft: IResourceCacheData<T>) => {
            draft.entries[key].status = EResourceStatus.Success;
            draft.entries[key].data = data;
            draft.entries[key].error = undefined;
            draft.entries[key].updatedAt = Date.now();
            draft.entries[key].refreshing = false;
            draft.entries[key].invalidated = false;
            draft.entries[key].failed = false;
        });

        // The request is gone, so this entry may have become droppable; until something else
        // touches the cache, settlement is the only check the bound gets.
        this.evict();
    };

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
    protected settleFailure = (key: string, controller: AbortController, error: unknown): void => {
        // The entry can be gone: evicted, or forgotten while the request was in flight. Writing into
        // a draft that no longer has it would throw rather than quietly do nothing.
        if (!this.isCurrent(key, controller) || !this.data.entries[key]) {
            return;
        }

        this.controllers.delete(key);
        this.requests.delete(key);
        this.failures.set(key, error);

        const hasData = this.data.entries[key] && this.data.entries[key].data !== undefined;

        this.update((draft: IResourceCacheData<T>) => {
            draft.entries[key].error = describeError(error);
            draft.entries[key].refreshing = false;
            draft.entries[key].failed = true;

            if (!hasData) {
                draft.entries[key].status = EResourceStatus.Error;
            }
        });

        this.evict();
    };
}
