import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceData, IResourceSnapshot, TResourceLoader} from "@/Carburetor/Models/Resource";
import {IUpdateScheduler} from "@/Carburetor/Models/Store";
import {Carburetor} from "@/Carburetor/Store/Carburetor";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";
import {getInitialResourceData} from "./getInitialResourceData";
import {createAbortHandle} from "./createAbortHandle";

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
    /**
     * The key the stored Success/Error state belongs to; unlike `pendingKey`, which tracks the
     * in-flight one. restore() re-establishes it from the snapshot.
     */
    protected settledKey: string | undefined = undefined;
    /** The arguments of the most recent start, which reload() replays. */
    protected lastArgs: TArgs | undefined = undefined;
    /** The key of that same start, which tells reload() a replay exists: unlike `pendingKey`,
     * abort() and restore() leave it in place. */
    protected lastKey: string | undefined = undefined;
    /** The raw rejection behind the described state.error, kept whole for suspend to rethrow. */
    protected lastError: unknown = undefined;
    /** Whether lastError belongs to the current Error state, including when it is undefined. */
    protected hasLastError: boolean = false;
    /** Changes when a newer operation takes ownership during synchronous abort callbacks. */
    protected operationVersion: number = 0;

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

    /**
     * The state plus the key its answer settled under: what travels across the serialization
     * boundary has to carry enough for the restored slot to tell which arguments the answer
     * belongs to.
     *
     * deepClone is repeated from the base rather than called through super: every base member
     * is an instance field, so there is no super.snapshot() to reach (TS2855).
     */
    public snapshot = (): IResourceSnapshot<T> => {
        return {...deepClone(this.data), key: this.settledKey};
    };

    /**
     * Installs a snapshot as the current state, and re-establishes the answer's identity
     * with it: the data alone says nothing about which arguments produced it.
     */
    public restore = (data: IResourceSnapshot<T>): void => {
        const operationVersion = ++this.operationVersion;

        // A restored snapshot replaces the answer wholesale, so a request still in flight is
        // serving a state about to stop existing: fire its handle and drop its bookkeeping,
        // the same mechanism abort() relies on. Its settlement later fails isCurrent() and
        // lands nowhere, which keeps the restored state from being corrupted by the stale
        // response. Unlike abort(), nothing is published here: the restored state follows.
        this.cancelInFlight();

        // Abort listeners run synchronously and may start a replacement or restore another
        // snapshot. That newer operation owns the slot and must not be overwritten here.
        if (this.operationVersion !== operationVersion) {
            return;
        }

        // Identity is re-established BEFORE the state lands: setData() notifies subscribers
        // synchronously, and a suspend() from such a callback must see key and data agree.
        // Only a settled answer carries a key — the same invariant start() maintains when it
        // clears the stored answer's key on going pending.
        const settled = data.status === EResourceStatus.Success || data.status === EResourceStatus.Error;
        this.settledKey = settled ? data.key : undefined;

        // The raw rejection cannot cross the serialization boundary: what the snapshot carries
        // is the message describeError() extracted, so the restored failure rethrows from a
        // reconstructed Error. Restoring a non-failure clears any stale one.
        this.hasLastError = data.status === EResourceStatus.Error;
        this.lastError = this.hasLastError ? new Error(data.error || '') : undefined;

        // A restored Pending status has no live request behind it (R3-04): this slot's fields
        // do not carry the arguments a fresh request would need, so restore cannot start one
        // itself the way it could serve a settled answer. Normalizing to Idle is what abort()
        // already leaves behind a cancelled request — a plain status reader sees no work
        // outstanding, instead of a Pending that nothing will ever settle. Whatever `data` the
        // snapshot carried travels through untouched, exactly as abort() also leaves it, and an
        // explicit load()/suspend() with the right arguments fetches normally afterward.
        const status = data.status === EResourceStatus.Pending ? EResourceStatus.Idle : data.status;

        // The key rides in the snapshot, not in the state: the four state fields are installed
        // explicitly so the live IResourceData contract stays exactly what it was.
        this.setData(deepClone({
            status,
            data: data.data,
            error: data.error,
            updatedAt: data.updatedAt,
        }));
    };

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
            throw this.hasLastError ? this.lastError : new Error(state.error || 'Carburetor: resource failed');
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
        // The replay target is the last requested start, not the in-flight key: abort() clears
        // the key of the request it cancels, while what was requested last stays repeatable.
        if (this.lastKey === undefined) {
            return Promise.resolve();
        }

        const args = this.lastArgs as TArgs;

        this.pendingKey = undefined;
        this.pendingRequest = undefined;

        return this.start(args, false);
    };

    /** Cancels the request in flight; its result is ignored when it arrives, and the slot returns to Idle. */
    public abort = (): void => {
        if (!this.controller) {
            return;
        }

        const operationVersion = ++this.operationVersion;
        this.cancelInFlight();

        // An abort listener may have started a new request. Preserve its Pending state.
        if (this.operationVersion !== operationVersion) {
            return;
        }

        // A cancelled request leaves nothing on its way: Pending would claim an answer no one
        // will ever deliver, so the slot goes back to the state it starts in.
        this.draft.status = EResourceStatus.Idle;
        this.emitUpdate();
    };

    /**
     * The bookkeeping half of abort(): fires the handle and drops the request, writing nothing.
     *
     * Shared with start(), which replaces a request rather than giving up on one — only abort()
     * publishes the slot going idle.
     */
    protected cancelInFlight = (): void => {
        const controller = this.controller;

        if (!controller) {
            return;
        }

        // Detach before dispatch: AbortSignal listeners run synchronously and may load again.
        this.controller = undefined;
        this.pendingRequest = undefined;
        this.pendingKey = undefined;
        controller.abort();
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

        const operationVersion = ++this.operationVersion;
        this.cancelInFlight();

        // A synchronous abort listener may have started a newer request. If it is for the
        // same key, join it; otherwise this start was superseded before it could begin.
        if (this.operationVersion !== operationVersion) {
            return this.pendingKey === key && this.pendingRequest
                ? this.pendingRequest
                : Promise.resolve();
        }

        const controller = createAbortHandle();

        this.controller = controller;
        this.pendingKey = key;
        this.lastArgs = args;
        this.lastKey = key;
        this.hasLastError = false;

        // `load` and `reload` both come through here, so starting a request replaces
        // whatever the slot held: the old answer stops being served from this moment.
        this.settledKey = undefined;

        this.draft.status = EResourceStatus.Pending;
        this.draft.error = undefined;

        let resolveRequest: () => void = () => undefined;
        let rejectRequest: (error: unknown) => void = () => undefined;
        const request = new Promise<void>((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        });
        this.pendingRequest = request;

        if (deferNotification) {
            this.emitSoon();
        } else {
            this.emitUpdate();
        }

        // A synchronous subscriber may replace or abort this request during publication.
        // Do not start a loader whose result is already obsolete.
        if (!this.isCurrent(controller)) {
            resolveRequest();

            return request;
        }

        // A loader may throw before returning its promise; routing the throw through the same
        // rejection path keeps the slot from holding a Pending no request will ever settle.
        let answer: Promise<T>;

        try {
            answer = this.loader(args, controller.signal);
        } catch (error: unknown) {
            answer = Promise.reject(error);
        }

        void answer.then(
            (data: T) => {
                this.settleSuccess(controller, key, data);
            },
            (error: unknown) => {
                this.settleError(controller, key, error);
            }
        ).then(resolveRequest, rejectRequest);

        return request;
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
        this.hasLastError = false;

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
        this.hasLastError = true;

        this.draft.status = EResourceStatus.Error;
        this.draft.error = describeError(error);
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };
}
