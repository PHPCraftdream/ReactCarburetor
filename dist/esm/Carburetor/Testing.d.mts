import { ICarburetorSubscription } from "./Models.mjs";
/**
 * Resolves on the next update of a carburetor or computed. Useful for throttled stores
 * and async resources, where an update does not arrive within the current tick.
 */
export declare const waitForUpdate: (source: ICarburetorSubscription, timeout?: number) => Promise<void>;
