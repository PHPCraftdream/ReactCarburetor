import { IResourceData, IResourceSnapshot, TResourceLoader } from "../Models/Resource.mjs";
import { IUpdateScheduler } from "../Models/Store.mjs";
import { Carburetor } from "../Store/Carburetor.mjs";
/**
 * An async value with an explicit status, so loading and failure are part of the state
 * rather than something every component reinvents. Concurrent loads with the same
 * arguments share one request; a load with different arguments aborts the previous one.
 *
 * The slot holds one answer, and `suspend` serves it only for the key it actually
 * settled: reading with any other key starts a fresh request instead of handing over
 * the previous record's data.
 */
export declare class ResourceCarburetor<T, TArgs = void> extends Carburetor<IResourceData<T>> {
    protected loader: TResourceLoader<T, TArgs>;
    /** The abort handle of the request in flight, fired by abort() and compared against when it settles. */
    protected controller: AbortController | undefined;
    /** The key that request was started with, which a repeated start joins on. */
    protected pendingKey: string | undefined;
    /** The promise behind it: what suspend throws to React and a joining start returns. */
    protected pendingRequest: Promise<void> | undefined;
    /**
     * The key the stored Success/Error state belongs to; unlike `pendingKey`, which tracks the
     * in-flight one. restore() re-establishes it from the snapshot.
     */
    protected settledKey: string | undefined;
    /** The arguments of the most recent start, which reload() replays. */
    protected lastArgs: TArgs | undefined;
    /** The key of that same start, which tells reload() a replay exists: unlike `pendingKey`,
     * abort() and restore() leave it in place. */
    protected lastKey: string | undefined;
    /** The raw rejection behind the described state.error, kept whole for suspend to rethrow. */
    protected lastError: unknown;
    /** Whether lastError belongs to the current Error state, including when it is undefined. */
    protected hasLastError: boolean;
    /** Changes when a newer operation takes ownership during synchronous abort callbacks. */
    protected operationVersion: number;
    /**
     * Takes the loader this resource calls, and starts out empty.
     *
     * @param loader - called with the arguments and an abort signal; the single slot means a newer
     * start aborts it, so two of its runs are never alive at once
     * @param scheduler - the policy deciding when subscribers are woken; omitted, updates publish
     * synchronously on each write
     */
    constructor(loader: TResourceLoader<T, TArgs>, scheduler?: IUpdateScheduler);
    /**
     * The state plus the key its answer settled under: what travels across the serialization
     * boundary has to carry enough for the restored slot to tell which arguments the answer
     * belongs to.
     *
     * deepClone is repeated from the base rather than called through super: every base member
     * is an instance field, so there is no super.snapshot() to reach (TS2855).
     */
    snapshot: () => IResourceSnapshot<T>;
    /**
     * Installs a snapshot as the current state, and re-establishes the answer's identity
     * with it: the data alone says nothing about which arguments produced it.
     */
    restore: (data: IResourceSnapshot<T>) => void;
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
    /** Cancels the request in flight; its result is ignored when it arrives, and the slot returns to Idle. */
    abort: () => void;
    /**
     * The bookkeeping half of abort(): fires the handle and drops the request, writing nothing.
     *
     * Shared with start(), which replaces a request rather than giving up on one — only abort()
     * publishes the slot going idle.
     */
    protected cancelInFlight: () => void;
    /**
     * The one path into a request: deduplicates, aborts the previous one, publishes pending.
     *
     * `deferNotification` exists for `suspend`, which is called from render — the pending
     * status then goes out on a microtask instead of in the middle of rendering.
     *
     * @param args - folded into the request key by keyOf(), so structurally equal arguments join
     * one request; also what reload() replays
     * @param deferNotification - true from suspend(): the pending write goes out on a microtask
     * because the caller is mid-render
     */
    protected start: (args: TArgs, deferNotification: boolean) => Promise<void>;
    /** The identity of a set of arguments, for telling one request from another. */
    protected keyOf: (args: TArgs) => string;
    /** Whether a settled request is still the one whose answer this resource wants. */
    protected isCurrent: (controller: AbortController) => boolean;
    /**
     * Stores a successful answer, unless a newer request has since taken over.
     *
     * @param controller - the request claiming the write; one already aborted or replaced fails
     * the check, and its answer is dropped whole
     * @param key - recorded as the settled key, so suspend serves this answer only to a read of
     * the same arguments
     * @param data - the answer stored verbatim; landing it also drops any raw error an earlier
     * failure had kept
     */
    protected settleSuccess: (controller: AbortController, key: string, data: T) => void;
    /**
     * Stores a failure, keeping the raw rejection aside for `suspend` to rethrow.
     *
     * @param controller - the request reporting the failure; a superseded or aborted one is
     * ignored, leaving the newer request's outcome in charge
     * @param key - recorded as the settled key, so the Error state is only served to a read of
     * these arguments
     * @param error - the rejection as thrown: lastError keeps it whole, while the state carries
     * only the message describeError() extracts
     */
    protected settleError: (controller: AbortController, key: string, error: unknown) => void;
}
