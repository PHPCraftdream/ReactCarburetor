import {TDisposer} from "../Models/Base";
import {ICarburetor} from "../Models/Store";
import {IPersistOptions} from "../Models/Tooling";
import {WILDCARD_PATH} from "../Store/Paths/WildcardPath";

/**
 * Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
 * writes a snapshot on every change. Returns a disposer that stops the mirroring.
 */
export const persist = <T extends {}>(carburetor: ICarburetor<T>, options: IPersistOptions): TDisposer => {
    const {key, storage} = options;
    const stored = storage.getItem(key);

    if (stored !== null) {
        try {
            carburetor.restore(JSON.parse(stored) as T);
        } catch (error: unknown) {
            storage.removeItem(key);

            if (options.onError) {
                options.onError(error);
            }
        }
    }

    return carburetor.watch(new Set([WILDCARD_PATH]), () => {
        storage.setItem(key, JSON.stringify(carburetor.snapshot()));
    });
};
