import {IResourceData, TResourceLoader} from "../Models/Resource";
import {IUpdateScheduler} from "../Models/Store";
import {Carburetor} from "../Store/Carburetor";
import {getInitialResourceData} from "./getInitialResourceData";

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

    constructor(protected loader: TResourceLoader<T, TArgs>, scheduler?: IUpdateScheduler) {
        super(getInitialResourceData<T>(), scheduler);
    }

    /** The raw rejection value, which the serializable state cannot carry. */
    public getLastError = (): unknown => {
        return this.lastError;
    };

    /**
     * Reads the value, suspending the component while the request is in flight, and
     * rethrowing the failure so the nearest error boundary handles it. The request is
     * started on first read; its "pending" notification is deferred to a microtask,
     * because a render must not notify subscribers.
     */
    public suspend = (args: TArgs): T => {
        const state = this.data;

        if (state.status === 'success') {
            return state.data as T;
        }

        if (state.status === 'error') {
            throw this.lastError || new Error(state.error || 'Carburetor: resource failed');
        }

        if (this.pendingRequest && this.pendingKey === this.keyOf(args)) {
            throw this.pendingRequest;
        }

        throw this.start(args, true);
    };

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

    public abort = (): void => {
        if (!this.controller) {
            return;
        }

        this.controller.abort();
        this.controller = undefined;
        this.pendingRequest = undefined;
        this.pendingKey = undefined;
    };

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

        this.draft.status = 'pending';
        this.draft.error = undefined;

        if (deferNotification) {
            queueMicrotask(this.emitUpdate);
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

    protected keyOf = (args: TArgs): string => {
        return JSON.stringify(args === undefined ? null : args);
    };

    protected isCurrent = (controller: AbortController): boolean => {
        return this.controller === controller && !controller.signal.aborted;
    };

    protected settleSuccess = (controller: AbortController, data: T): void => {
        if (!this.isCurrent(controller)) {
            return;
        }

        this.controller = undefined;
        this.pendingRequest = undefined;
        this.lastError = undefined;

        this.draft.status = 'success';
        this.draft.data = data;
        this.draft.error = undefined;
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };

    protected settleError = (controller: AbortController, error: unknown): void => {
        if (!this.isCurrent(controller)) {
            return;
        }

        this.controller = undefined;
        this.pendingRequest = undefined;
        this.lastError = error;

        this.draft.status = 'error';
        this.draft.error = describeError(error);
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };
}
