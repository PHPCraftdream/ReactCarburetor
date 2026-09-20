import {ICarburetor, TDisposer} from "./Models";
import {WILDCARD_PATH} from "./Paths";

/** The part of the Storage API this needs, so tests do not require a browser. */
export interface IStorageLike {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
}

export interface IPersistOptions {
    key: string;
    storage: IStorageLike;
    /** Called when stored data cannot be read; by default the bad entry is dropped. */
    onError?: (error: unknown) => void;
}

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
