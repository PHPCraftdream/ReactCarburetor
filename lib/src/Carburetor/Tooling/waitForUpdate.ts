import {ICarburetorSubscription} from "../Models/Store";
import {storeLifecycle} from "../Store/Diagnostics/Internal/StoreLifecycle";
import {WILDCARD_PATH} from "../Store/Paths/WildcardPath";

/** Every write: built once, since subscribe copies the reads it is given. */
const EVERY_WRITE = {reads: new Set([WILDCARD_PATH])};

/**
 * Resolves on the next update of a carburetor or computed. Useful for throttled stores
 * and async resources, where an update does not arrive within the current tick.
 *
 * The timeout runs on wall time, also for a store on a test clock: it guards the test, it is
 * not part of the store's timeline. A store disposed while waiting, or already disposed, can
 * never update, so the promise rejects at once with `waitForUpdate: the store was disposed`.
 *
 * @param source - subscribed to every update; the subscription is dropped on resolve or timeout
 * @param timeout - milliseconds to wait before rejecting; defaults to 1000
 */
export const waitForUpdate = (source: ICarburetorSubscription, timeout: number = 1000): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        if (storeLifecycle.isDisposed(source)) {
            reject(new Error('waitForUpdate: the store was disposed'));
            return;
        }
        const id = source.subscribe(
            () => {
                settle();
                resolve();
            },
            EVERY_WRITE
        );
        const timer = setTimeout(() => {
            settle();
            reject(new Error('waitForUpdate: no update within ' + timeout + 'ms'));
        }, timeout);
        // Only a store disposes through storeLifecycle; for a computed this never runs.
        const release = storeLifecycle.onDispose(source, () => {
            settle();
            reject(new Error('waitForUpdate: the store was disposed'));
        });
        const settle = (): void => {
            clearTimeout(timer);
            release();
            source.unsubscribe(id);
        };
    });
};
