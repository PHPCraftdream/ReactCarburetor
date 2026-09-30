"use client";

import {useCallback, useSyncExternalStore} from "react";
import {IComputed} from "@/Carburetor";
import {getComputedSnapshotVersion} from "@/Carburetor/Derived/Freshness/getComputedSnapshotVersion";

interface IComputedSnapshot<R> {
    readonly source: IComputed<R>;
    readonly version: number;
    readonly value: R;
}

const snapshots = new WeakMap<IComputed<unknown>, IComputedSnapshot<unknown>>();

const readSnapshot = <R>(source: IComputed<R>): IComputedSnapshot<R> => {
    // A lazy read may settle a publication, so read its version afterwards.
    const value = source.get();
    const version = getComputedSnapshotVersion(source);
    const previous = snapshots.get(source) as IComputedSnapshot<R> | undefined;

    if (previous && previous.version === version && Object.is(previous.value, value)) {
        return previous;
    }

    const snapshot = {source, version, value};

    snapshots.set(source, snapshot);

    return snapshot;
};

/**
 * Reads a computed publication. The returned value stays live; the cached snapshot
 * record detects publications without cloning the value.
 *
 * @param computed - the source read and subscribed to
 */
export const useComputedValue = <R>(computed: IComputed<R>): R => {
    const subscribe = useCallback(
        (onStoreChange: () => void) => {
            const id = computed.subscribe(onStoreChange);

            return () => computed.unsubscribe(id);
        },
        [computed]
    );

    const getSnapshot = useCallback(() => readSnapshot(computed), [computed]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).value;
};
