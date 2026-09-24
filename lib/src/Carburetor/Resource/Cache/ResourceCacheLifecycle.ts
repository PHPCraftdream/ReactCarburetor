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
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";
import {describeError} from "@/Carburetor/Resource/describeError";
import {createAbortHandle} from "@/Carburetor/Resource/createAbortHandle";
import {getInitialCacheEntry} from "./getInitialCacheEntry";

const DEFAULT_TTL: number = 30_000;
const DEFAULT_MAX_ENTRIES: number = 100;
const ENTRIES_PREFIX: string = `entries${PATH_SEPARATOR}`;

/** Owns cache entry lifecycles, request state and eviction. */
export abstract class ResourceCacheLifecycle<T, TArgs> extends Carburetor<IResourceCacheData<T>> {
    /** Time before a successful entry becomes stale, in milliseconds. */
    protected ttl: number;
    /** Maximum number of unretained entries to keep. */
    protected maxEntries: number;
    /** In-flight requests by cache key. */
    protected requests: Map<string, Promise<void>> = new Map<string, Promise<void>>();
    /** Abort controllers for in-flight requests. */
    protected controllers: Map<string, AbortController> = new Map<string, AbortController>();
    /** Raw request failures by cache key. */
    protected failures: Map<string, unknown> = new Map<string, unknown>();
    /** Last access ticks used for eviction order. */
    protected lastUsed: Map<string, number> = new Map<string, number>();
    /** Monotonic counter for access order. */
    protected useTick: number = 0;
    /** Stable views for unchanged entries. */
    protected viewCache: Map<string, IResourceView<T>> = new Map<string, IResourceView<T>>();

    /** Resolve arguments to an entry key. */
    protected abstract keyOf: (args: TArgs) => string;

    /** Configure request lifecycle and cache capacity.
     * @param loader - Function that loads a resource.
     * @param options - Cache and scheduler settings.
     */
    protected constructor(protected loader: TResourceLoader<T, TArgs>, options: IResourceCacheOptions = {}) {
        super({entries: {}}, options.scheduler);

        this.ttl = options.ttl === undefined ? DEFAULT_TTL : options.ttl;
        this.maxEntries = options.maxEntries === undefined ? DEFAULT_MAX_ENTRIES : options.maxEntries;
    }

    /** Restore entries without reviving in-flight requests. */
    public restore = (data: IResourceCacheData<T>): void => {
        this.controllers.forEach((controller: AbortController) => controller.abort());
        this.controllers.clear();
        this.requests.clear();
        this.failures.clear();
        this.viewCache.clear();
        this.lastUsed.clear();

        const entries: IResourceCacheData<T>['entries'] = {};

        Object.keys(data.entries).forEach((key: string) => {
            const entry = data.entries[key];

            entries[key] = {
                ...entry,
                refreshing: false,
                status: entry.status === EResourceStatus.Pending ? EResourceStatus.Idle : entry.status,
            };
        });

        this.setData(deepClone({entries}));
    };

    /** Record an entry access for eviction order. */
    protected touch = (key: string): void => {
        this.useTick += 1;
        this.lastUsed.set(key, this.useTick);
    };

    /** Load an entry unless its current value is fresh. */
    public load = (args: TArgs): Promise<void> => {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];

        this.touch(key);

        if (entry && entry.status === EResourceStatus.Success && !this.isStale(entry)) {
            return Promise.resolve();
        }

        return this.fetch(key, args);
    };

    /** Request an entry even when its current value is fresh. */
    public refresh = (args: TArgs): Promise<void> => {
        const key = this.keyOf(args);

        this.touch(key);
        return this.fetch(key, args);
    };

    /** Abort the request for one argument set. */
    public abort = (args: TArgs): void => {
        this.abortKey(this.keyOf(args));
    };

    /** Abort all in-flight requests. */
    public abortAll = (): void => {
        Array.from(this.controllers.keys()).forEach((key: string) => this.abortKey(key));
    };

    /** Mark an entry stale without removing its data. */
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

    /** Mark every entry stale. */
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

    /** Remove an entry and cancel its request. */
    public forget = (args: TArgs): void => {
        this.forgetKey(this.keyOf(args));
    };

    /** Remove all entries and cancel their requests. */
    public forgetAll = (): void => {
        Object.keys(this.data.entries).forEach((key: string) => this.forgetKey(key));
    };

    /** Remove the entry at a resolved cache key. */
    protected forgetKey = (key: string): void => {
        this.abortKey(key);
        this.failures.delete(key);
        this.lastUsed.delete(key);
        this.viewCache.delete(key);

        if (!this.data.entries[key]) {
            return;
        }

        this.update((draft: IResourceCacheData<T>) => {
            delete draft.entries[key];
        });
    };

    /** Report whether the entry needs a fresh request. */
    protected isStale = (entry: IResourceEntry<T>): boolean => {
        if (entry.invalidated || entry.updatedAt === undefined) {
            return true;
        }

        return Date.now() - entry.updatedAt > this.ttl;
    };

    /** Check whether a cached view still reflects its entry.
     * @param view - Previously published view.
     * @param entry - Current stored entry.
     * @param stale - Current freshness verdict.
     */
    protected isViewCurrent = (view: IResourceView<T>, entry: IResourceEntry<T>, stale: boolean): boolean => {
        return view.stale === stale
            && view.status === entry.status
            && view.data === entry.data
            && view.error === entry.error
            && view.updatedAt === entry.updatedAt
            && view.refreshing === entry.refreshing
            && view.invalidated === entry.invalidated
            && view.failed === entry.failed;
    };

    /** Find entries currently retained by subscribers. */
    protected retainedKeys = (): Set<string> => {
        const retained = new Set<string>();

        Object.keys(this.subscribers).forEach((id: string) => {
            this.subscribers[id].reads.forEach((read: TPath) => {
                if (!read.startsWith(ENTRIES_PREFIX)) {
                    return;
                }

                const segment = read.slice(ENTRIES_PREFIX.length).split(PATH_SEPARATOR)[0];

                if (segment) {
                    retained.add(segment);
                }
            });
        });

        return retained;
    };

    /** Evict the least recently used unretained entries. */
    protected evict = (deferNotification: boolean = false): void => {
        const keys = Object.keys(this.data.entries);

        if (keys.length <= this.maxEntries) {
            return;
        }

        const retained = this.retainedKeys();
        const candidates = keys
            .filter((key: string) => !this.requests.has(key) && !retained.has(joinPath('', key)))
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
            this.viewCache.delete(key);
        });

        const draft = this.draft;

        doomed.forEach((key: string) => {
            delete draft.entries[key];
        });

        if (deferNotification) {
            if (!this.pendingEmit) {
                this.emitSoon();
            }

            return;
        }

        this.emitUpdate();
    };

    /** Abort an entry by its resolved key. */
    protected abortKey = (key: string): void => {
        const controller = this.controllers.get(key);

        if (!controller) {
            return;
        }

        controller.abort();
        this.controllers.delete(key);
        this.requests.delete(key);

        const entry = this.data.entries[key];

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

    /** Return a ready value or throw its pending request or failure. */
    public suspend = (args: TArgs): T => {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];

        this.touch(key);

        if (entry && entry.status === EResourceStatus.Success && entry.data !== undefined) {
            return entry.data;
        }

        if (entry && entry.status === EResourceStatus.Error) {
            throw this.failures.has(key)
                ? this.failures.get(key)
                : new Error(entry.error || 'Carburetor: resource failed');
        }

        const known = this.requests.get(key);

        throw known || this.fetch(key, args, true);
    };

    /** Start or reuse a request for an entry.
     * @param key - Resolved cache key.
     * @param args - Loader arguments.
     * @param deferNotification - Whether to defer the update notification.
     */
    protected fetch = (key: string, args: TArgs, deferNotification: boolean = false): Promise<void> => {
        const known = this.requests.get(key);

        if (known) {
            return known;
        }

        const controller = createAbortHandle();
        let resolveRequest: () => void = () => undefined;
        let rejectRequest: (error: unknown) => void = () => undefined;
        const request = new Promise<void>((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        });

        this.controllers.set(key, controller);
        this.requests.set(key, request);
        this.markLoading(key, deferNotification);

        // Publication can synchronously abort or replace this key's request.
        if (!this.isCurrent(key, controller)) {
            resolveRequest();

            return request;
        }

        let answer: Promise<T>;

        try {
            answer = this.loader(args, controller.signal);
        } catch (error: unknown) {
            answer = Promise.reject(error);
        }

        void answer.then(
            (data: T) => {
                this.settleSuccess(key, controller, data);
            },
            (error: unknown) => {
                this.settleFailure(key, controller, error);
            }
        ).then(resolveRequest, rejectRequest);

        this.evict(deferNotification);

        return request;
    };

    /** Publish the loading state of an entry.
     * @param key - Resolved cache key.
     * @param deferNotification - Whether to defer the update notification.
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

    /** Check that a request still owns the entry.
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     */
    protected isCurrent = (key: string, controller: AbortController): boolean => {
        return this.controllers.get(key) === controller && !controller.signal.aborted;
    };

    /** Store the value returned by a current request.
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     * @param data - Loaded resource value.
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

        this.evict();
    };

    /** Store the failure returned by a current request.
     * @param key - Resolved cache key.
     * @param controller - Controller belonging to the request.
     * @param error - Raw request failure.
     */
    protected settleFailure = (key: string, controller: AbortController, error: unknown): void => {
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
