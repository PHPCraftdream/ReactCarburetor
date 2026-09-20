import {useCallback, useSyncExternalStore} from "react";
import {IComputed} from "@/Carburetor";

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
