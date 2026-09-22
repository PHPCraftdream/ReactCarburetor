import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceData, TResourceLoader} from "@/Carburetor/Models/Resource";
import {IUpdateScheduler} from "@/Carburetor/Models/Store";
import {Carburetor} from "@/Carburetor/Store/Carburetor";
import {getInitialResourceData} from "./getInitialResourceData";

/** The message a failure is stored under: the state has to stay serializable. */
const describeError = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
};

/**
 * An async value with an explicit status, so loading and failure are part of the state
 * rather than something every component reinvents. Concurrent loads with the same
 * arguments share one request; a load with different arguments aborts the previous one.
 *
 * The slot holds one answer, and `suspend` serves it only for the key it actually
 * settled: reading with any other key starts a fresh request instead of handing over
 * the previous record's data.
 */
export class ResourceCarburetor<T, TArgs = void> extends Carburetor<IResourceData<T>> {
    /** The abort handle of the request in flight, fired by abort() and compared against when it settles. */
    protected controller: AbortController | undefined = undefined;
    /** The key that request was started with, which a repeated start joins on. */
    protected pendingKey: string | undefined = undefined;
    /** The promise behind it: what suspend throws to React and a joining start returns. */
    protected pendingRequest: Promise<void> | undefined = undefined;
    /** The key the stored Success/Error state belongs to; unlike `pendingKey`, which tracks the in-flight one. */
    protected settledKey: string | undefined = undefined;
    /** The arguments of the most recent start, which reload() replays. */
    protected lastArgs: TArgs | undefined = undefined;
    /** The raw rejection behind the described state.error, kept whole for suspend to rethrow. */
    protected lastError: unknown = undefined;

    /**
     * Takes the loader this resource calls, and starts out empty.
     *
     * @param loader - called with the arguments and an abort signal; the single slot means a newer
     * start aborts it, so two of its runs are never alive at once
     * @param scheduler - the policy deciding when subscribers are woken; omitted, updates publish
     * synchronously on each write
     */
    constructor(protected loader: TResourceLoader<T, TArgs>, scheduler?: IUpdateScheduler) {
        super(getInitialResourceData<T>(), scheduler);
    }

    /** The raw rejection value, which the serializable state cannot carry. */
    public getLastError = (): unknown => {
        return this.lastError;
    };

    /**
     * Reads the value, suspending while it loads and rethrowing when it failed.
     *
     * The request is started on first read, and its "pending" notification is deferred to a
     * microtask, because a render must not notify subscribers. A failure is rethrown so the
     * nearest error boundary handles it.
     */
    public suspend = (args: TArgs): T => {
        const state = this.data;
        const key = this.keyOf(args);

        // A stored answer is only good for the key that produced it: anything else falls
        // through to a fresh request, exactly like a key that was never loaded.
        if (state.status === EResourceStatus.Success && this.settledKey === key) {
            return state.data as T;
        }

        if (state.status === EResourceStatus.Error && this.settledKey === key) {
            throw this.lastError || new Error(state.error || 'Carburetor: resource failed');
        }

        if (this.pendingRequest && this.pendingKey === key) {
            throw this.pendingRequest;
        }

        throw this.start(args, true);
    };

    /** Starts a load, or joins the one already in flight for the same arguments. */
    public load = (args: TArgs): Promise<void> => {
        return this.start(args, false);
    };

    /** Repeats the last load with the same arguments. */
    public reload = (): Promise<void> => {
        if (this.pendingKey === undefined) {
            return Promise.resolve();
        }

        const args = this.lastArgs as TArgs;

        this.pendingKey = undefined;
        this.pendingRequest = undefined;

        return this.start(args, false);
    };

    /** Cancels the request in flight; its result is ignored when it arrives. */
    public abort = (): void => {
        if (!this.controller) {
            return;
        }

        this.controller.abort();
        this.controller = undefined;
        this.pendingRequest = undefined;
        this.pendingKey = undefined;
        // `settledKey` needs no clearing: this only runs with a request in flight, and the
        // `start` that armed it already reset the stored answer's key.
    };

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
    protected start = (args: TArgs, deferNotification: boolean): Promise<void> => {
        const key = this.keyOf(args);

        if (this.pendingRequest && this.pendingKey === key) {
            return this.pendingRequest;
        }

        this.abort();

        const controller = new AbortController();

        this.controller = controller;
        this.pendingKey = key;
        this.lastArgs = args;

        // `load` and `reload` both come through here, so starting a request replaces
        // whatever the slot held: the old answer stops being served from this moment.
        this.settledKey = undefined;

        this.draft.status = EResourceStatus.Pending;
        this.draft.error = undefined;

        if (deferNotification) {
            this.emitSoon();
        } else {
            this.emitUpdate();
        }

        this.pendingRequest = this.loader(args, controller.signal).then(
            (data: T) => {
                this.settleSuccess(controller, key, data);
            },
            (error: unknown) => {
                this.settleError(controller, key, error);
            }
        );

        return this.pendingRequest;
    };

    /** The identity of a set of arguments, for telling one request from another. */
    protected keyOf = (args: TArgs): string => {
        return JSON.stringify(args === undefined ? null : args);
    };

    /** Whether a settled request is still the one whose answer this resource wants. */
    protected isCurrent = (controller: AbortController): boolean => {
        return this.controller === controller && !controller.signal.aborted;
    };

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
    protected settleSuccess = (controller: AbortController, key: string, data: T): void => {
        if (!this.isCurrent(controller)) {
            return;
        }

        this.controller = undefined;
        this.pendingRequest = undefined;
        this.settledKey = key;
        this.lastError = undefined;

        this.draft.status = EResourceStatus.Success;
        this.draft.data = data;
        this.draft.error = undefined;
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };

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
    protected settleError = (controller: AbortController, key: string, error: unknown): void => {
        if (!this.isCurrent(controller)) {
            return;
        }

        this.controller = undefined;
        this.pendingRequest = undefined;
        this.settledKey = key;
        this.lastError = error;

        this.draft.status = EResourceStatus.Error;
        this.draft.error = describeError(error);
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };
}
