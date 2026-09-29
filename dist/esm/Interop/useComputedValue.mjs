"use client";
import { useCallback, useSyncExternalStore } from "react";
const snapshots = new WeakMap();
const readSnapshot = (source)=>{
    const value = source.get();
    const version = source.getVersion();
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
