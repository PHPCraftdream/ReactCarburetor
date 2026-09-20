import { useCallback, useSyncExternalStore } from "react";
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
export { useComputedValue };
