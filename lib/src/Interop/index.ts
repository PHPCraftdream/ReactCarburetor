import {useCallback, useRef, useSyncExternalStore} from "react";
import {ICarburetor, IComputed, TPath, TReadonly} from "../Carburetor";

/**
 * Optional bridge for embedding a carburetor into a hooks-based subtree — a router shell,
 * a third-party UI kit, an existing hooks codebase. The engine itself needs no hooks;
 * this entry point exists only for the boundary with code that does.
 */

export type TSelector<T, R> = (data: TReadonly<T>) => R;

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
    isEqual: (a: R, b: R) => boolean = Object.is
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

/** Reads a memoized derived value from a hooks-based component. */
export const useComputedValue = <R>(computed: IComputed<R>): R => {
    const subscribe = useCallback(
        (onStoreChange: () => void) => {
            const id = computed.subscribe(onStoreChange);

            return () => computed.unsubscribe(id);
        },
        [computed]
    );

    const getSnapshot = useCallback(() => computed.get(), [computed]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

