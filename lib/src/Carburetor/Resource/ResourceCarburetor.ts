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
 */
export class ResourceCarburetor<T, TArgs = void> extends Carburetor<IResourceData<T>> {
    protected controller: AbortController | undefined = undefined;
    protected pendingKey: string | undefined = undefined;
    protected pendingRequest: Promise<void> | undefined = undefined;
    protected lastArgs: TArgs | undefined = undefined;
    protected lastError: unknown = undefined;

    /** Takes the loader this resource calls, and starts out empty. */
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

        if (state.status === EResourceStatus.Success) {
            return state.data as T;
        }

        if (state.status === EResourceStatus.Error) {
            throw this.lastError || new Error(state.error || 'Carburetor: resource failed');
        }

        if (this.pendingRequest && this.pendingKey === this.keyOf(args)) {
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
    };

    /**
     * The one path into a request: deduplicates, aborts the previous one, publishes pending.
     *
     * `deferNotification` exists for `suspend`, which is called from render — the pending
     * status then goes out on a microtask instead of in the middle of rendering.
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

        this.draft.status = EResourceStatus.Pending;
        this.draft.error = undefined;

        if (deferNotification) {
            this.emitSoon();
        } else {
            this.emitUpdate();
        }

        this.pendingRequest = this.loader(args, controller.signal).then(
            (data: T) => {
                this.settleSuccess(controller, data);
            },
            (error: unknown) => {
                this.settleError(controller, error);
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

    /** Stores a successful answer, unless a newer request has since taken over. */
    protected settleSuccess = (controller: AbortController, data: T): void => {
        if (!this.isCurrent(controller)) {
            return;
        }

        this.controller = undefined;
        this.pendingRequest = undefined;
        this.lastError = undefined;

        this.draft.status = EResourceStatus.Success;
        this.draft.data = data;
        this.draft.error = undefined;
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };

    /** Stores a failure, keeping the raw rejection aside for `suspend` to rethrow. */
    protected settleError = (controller: AbortController, error: unknown): void => {
        if (!this.isCurrent(controller)) {
            return;
        }

        this.controller = undefined;
        this.pendingRequest = undefined;
        this.lastError = error;

        this.draft.status = EResourceStatus.Error;
        this.draft.error = describeError(error);
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };
}
