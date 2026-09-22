import { ICarburetorSubscription } from "../Models/Store.js";
/**
 * Resolves on the next update of a carburetor or computed. Useful for throttled stores
 * and async resources, where an update does not arrive within the current tick.
 *
 * @param source - subscribed to every update; the subscription is dropped on resolve or timeout
 * @param timeout - milliseconds to wait before rejecting; defaults to 1000
 */
export declare const waitForUpdate: (source: ICarburetorSubscription, timeout?: number) => Promise<void>;
