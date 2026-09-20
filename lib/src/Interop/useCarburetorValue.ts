import {useCallback, useRef, useSyncExternalStore} from "react";
import {ICarburetor, TPath} from "../Carburetor";
import {TSelector, TValueComparator} from "./Models";

interface ICacheEntry<R> {
    version: number;
    value: R;
    filled: boolean;
}

/**
 * Subscribes to exactly the paths the selector reads, the same precision the class API
 * gets. The selector result is cached per store version, so useSyncExternalStore sees a
 * stable snapshot even when the selector builds a new object.
 */
export const useCarburetorValue = <T extends {}, R>(
    carburetor: ICarburetor<T>,
    select: TSelector<T, R>,
    isEqual: TValueComparator<R> = Object.is
): R => {
    const cache = useRef<ICacheEntry<R>>({version: -1, value: undefined as unknown as R, filled: false});

    const subscribe = useCallback(
        (onStoreChange: () => void) => {
            const reads = new Set<TPath>();

            // Run the selector once through the tracking proxy to learn what it depends on.
            select(carburetor.read((path: TPath) => reads.add(path)));

            const id = carburetor.subscribe(onStoreChange, undefined, reads);

            return () => carburetor.unsubscribe(id);
        },
        [carburetor, select]
    );

    const getSnapshot = useCallback((): R => {
        const entry = cache.current;
        const version = carburetor.getVersion();

        if (entry.filled && entry.version === version) {
            return entry.value;
        }

        const next = select(carburetor.read(() => undefined));

        if (entry.filled && isEqual(entry.value, next)) {
            entry.version = version;

            return entry.value;
        }

        cache.current = {version, value: next, filled: true};

        return next;
    }, [carburetor, select, isEqual]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
