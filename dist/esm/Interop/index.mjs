import { useCallback, useRef, useSyncExternalStore } from "react";
const useCarburetorValue = (carburetor, select, isEqual = Object.is)=>{
    const cache = useRef({
        version: -1,
        value: void 0,
        filled: false
    });
    const subscribe = useCallback((onStoreChange)=>{
        const reads = new Set();
        select(carburetor.read((path)=>reads.add(path)));
        const id = carburetor.subscribe(onStoreChange, void 0, reads);
        return ()=>carburetor.unsubscribe(id);
    }, [
        carburetor,
        select
    ]);
    const getSnapshot = useCallback(()=>{
        const entry = cache.current;
        const version = carburetor.getVersion();
        if (entry.filled && entry.version === version) return entry.value;
        const next = select(carburetor.read(()=>void 0));
        if (entry.filled && isEqual(entry.value, next)) {
            entry.version = version;
            return entry.value;
        }
        cache.current = {
            version,
            value: next,
            filled: true
        };
        return next;
    }, [
        carburetor,
        select,
        isEqual
    ]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
const useComputedValue = (computed)=>{
    const subscribe = useCallback((onStoreChange)=>{
        const id = computed.subscribe(onStoreChange);
        return ()=>computed.unsubscribe(id);
    }, [
        computed
    ]);
    const getSnapshot = useCallback(()=>computed.get(), [
        computed
    ]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
export { useCarburetorValue, useComputedValue };
