import {TDisposer} from "@/Carburetor/Models/Base";
import {ICarburetor} from "@/Carburetor/Models/Store";
import {IPersistOptions} from "@/Carburetor/Models/Tooling";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";

/**
 * Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
 * writes a snapshot on every change. Returns a disposer that stops the mirroring.
 *
 * @param carburetor - both read and written: its snapshot is stored, stored data is restored into it
 * @param options - `key` and `storage` are required; a failed load or write reaches `onError` when given
 */
export const persist = <T extends object>(carburetor: ICarburetor<T>, options: IPersistOptions): TDisposer => {
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
        // A failing write must reach onError like a failed restore does, and must not cut
        // off the subscribers notified after this one; the last good entry stays in place.
        try {
            storage.setItem(key, JSON.stringify(carburetor.snapshot()));
        } catch (error: unknown) {
            if (options.onError) {
                options.onError(error);
            }
        }
    });
};
