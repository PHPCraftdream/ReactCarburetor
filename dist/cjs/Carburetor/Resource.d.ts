import { Carburetor } from "./Carburetor.js";
import { IUpdateScheduler } from "./Models.js";
export type TResourceStatus = 'idle' | 'pending' | 'success' | 'error';
export interface IResourceData<T> {
    status: TResourceStatus;
    data: T | undefined;
    /** Message only: the resource state has to stay serializable for SSR and devtools. */
    error: string | undefined;
    updatedAt: number | undefined;
}
export type TResourceLoader<T, TArgs> = (args: TArgs, signal: AbortSignal) => Promise<T>;
export declare const getInitialResourceData: <T extends unknown>() => IResourceData<T>;
/**
 * An async value with an explicit status, so loading and failure are part of the state
 * rather than something every component reinvents. Concurrent loads with the same
 * arguments share one request; a load with different arguments aborts the previous one.
 */
export declare class ResourceCarburetor<T, TArgs = undefined> extends Carburetor<IResourceData<T>> {
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
    load: (args: TArgs, deferNotification?: boolean) => Promise<void>;
    /** Repeats the last load with the same arguments. */
    reload: () => Promise<void>;
    abort: () => void;
    protected keyOf: (args: TArgs) => string;
    protected isCurrent: (controller: AbortController) => boolean;
    protected settleSuccess: (controller: AbortController, data: T) => void;
    protected settleError: (controller: AbortController, error: unknown) => void;
}
