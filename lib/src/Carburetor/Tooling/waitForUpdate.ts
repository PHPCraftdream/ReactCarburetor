import {ICarburetorSubscription} from "../Models/Store";
import {WILDCARD_PATH} from "../Store/Paths/WildcardPath";

/**
 * Resolves on the next update of a carburetor or computed. Useful for throttled stores
 * and async resources, where an update does not arrive within the current tick.
 */
export const waitForUpdate = (source: ICarburetorSubscription, timeout: number = 1000): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        const id = source.subscribe(
            () => {
                clearTimeout(timer);
                source.unsubscribe(id);
                resolve();
            },
            undefined,
            new Set([WILDCARD_PATH])
        );

        const timer = setTimeout(() => {
            source.unsubscribe(id);
            reject(new Error('waitForUpdate: no update within ' + timeout + 'ms'));
        }, timeout);
    });
};
