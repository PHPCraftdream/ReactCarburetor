import { IResourceData, TResourceLoader } from "../Models/Resource.mjs";
import { IUpdateScheduler } from "../Models/Store.mjs";
import { Carburetor } from "../Store/Carburetor.mjs";
/**
 * An async value with an explicit status, so loading and failure are part of the state
 * rather than something every component reinvents. Concurrent loads with the same
 * arguments share one request; a load with different arguments aborts the previous one.
 */
export declare class ResourceCarburetor<T, TArgs = void> extends Carburetor<IResourceData<T>> {
    protected loader: TResourceLoader<T, TArgs>;
    protected controller: AbortController | undefined;
    protected pendingKey: string | undefined;
    protected pendingRequest: Promise<void> | undefined;
    protected lastArgs: TArgs | undefined;
    protected lastError: unknown;
    /** Takes the loader this resource calls, and starts out empty. */
    constructor(loader: TResourceLoader<T, TArgs>, scheduler?: IUpdateScheduler);
    /** The raw rejection value, which the serializable state cannot carry. */
    getLastError: () => unknown;
    /**
     * Reads the value, suspending while it loads and rethrowing when it failed.
     *
     * The request is started on first read, and its "pending" notification is deferred to a
     * microtask, because a render must not notify subscribers. A failure is rethrown so the
     * nearest error boundary handles it.
     */
    suspend: (args: TArgs) => T;
    /** Starts a load, or joins the one already in flight for the same arguments. */
    load: (args: TArgs) => Promise<void>;
    /** Repeats the last load with the same arguments. */
    reload: () => Promise<void>;
    /** Cancels the request in flight; its result is ignored when it arrives. */
    abort: () => void;
    /**
     * The one path into a request: deduplicates, aborts the previous one, publishes pending.
     *
     * `deferNotification` exists for `suspend`, which is called from render — the pending
     * status then goes out on a microtask instead of in the middle of rendering.
     */
    protected start: (args: TArgs, deferNotification: boolean) => Promise<void>;
    /** The identity of a set of arguments, for telling one request from another. */
    protected keyOf: (args: TArgs) => string;
    /** Whether a settled request is still the one whose answer this resource wants. */
    protected isCurrent: (controller: AbortController) => boolean;
    /** Stores a successful answer, unless a newer request has since taken over. */
    protected settleSuccess: (controller: AbortController, data: T) => void;
    /** Stores a failure, keeping the raw rejection aside for `suspend` to rethrow. */
    protected settleError: (controller: AbortController, error: unknown) => void;
}
