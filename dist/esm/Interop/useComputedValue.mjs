"use client";
import { useCallback, useSyncExternalStore } from "react";
import { getComputedSnapshotVersion } from "../Carburetor/Derived/Freshness/getComputedSnapshotVersion.mjs";
const snapshots = new WeakMap();
const readSnapshot = (source)=>{
    const value = source.get();
    const version = getComputedSnapshotVersion(source);
    const previous = snapshots.get(source);
    if (previous && previous.version === version && Object.is(previous.value, value)) return previous;
    const snapshot = {
        source,
        version,
        value
    };
    snapshots.set(source, snapshot);
    return snapshot;
};
const useComputedValue = (computed)=>{
    const subscribe = useCallback((onStoreChange)=>{
        const id = computed.subscribe(onStoreChange);
        return ()=>computed.unsubscribe(id);
    }, [
        computed
    ]);
    const getSnapshot = useCallback(()=>readSnapshot(computed), [
        computed
    ]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).value;
};
export { useComputedValue };
