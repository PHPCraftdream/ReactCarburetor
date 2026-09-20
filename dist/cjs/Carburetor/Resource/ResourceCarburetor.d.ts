import { IResourceData, TResourceLoader } from "../Models/Resource.js";
import { IUpdateScheduler } from "../Models/Store.js";
import { Carburetor } from "../Store/Carburetor.js";
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
    constructor(loader: TResourceLoader<T, TArgs>, scheduler?: IUpdateScheduler);
    /** The raw rejection value, which the serializable state cannot carry. */
    getLastError: () => unknown;
    /**
     * Reads the value, suspending the component while the request is in flight, and
     * rethrowing the failure so the nearest error boundary handles it. The request is
     * started on first read; its "pending" notification is deferred to a microtask,
     * because a render must not notify subscribers.
     */
    suspend: (args: TArgs) => T;
    load: (args: TArgs) => Promise<void>;
    /** Repeats the last load with the same arguments. */
    reload: () => Promise<void>;
    abort: () => void;
    protected start: (args: TArgs, deferNotification: boolean) => Promise<void>;
    protected keyOf: (args: TArgs) => string;
    protected isCurrent: (controller: AbortController) => boolean;
    protected settleSuccess: (controller: AbortController, data: T) => void;
    protected settleError: (controller: AbortController, error: unknown) => void;
}
