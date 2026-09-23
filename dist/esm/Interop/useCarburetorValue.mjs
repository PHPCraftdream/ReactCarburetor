import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { deepClone, isTrackable } from "../Carburetor/index.mjs";
import { isExoticValue } from "../Carburetor/Store/Utils/isExoticValue.mjs";
const sameReads = (a, b)=>{
    if (a.size !== b.size) return false;
    for (const path of a)if (!b.has(path)) return false;
    return true;
};
const snapshotOpaque = (value)=>{
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Map) {
        const copy = new Map();
        value.forEach((member, key)=>{
            copy.set(key, deepClone(member));
        });
        return copy;
    }
    if (value instanceof Set) {
        const copy = new Set();
        value.forEach((member)=>{
            copy.add(deepClone(member));
        });
        return copy;
    }
    return value;
};
const useCarburetorValue = (carburetor, select, isEqual = Object.is)=>{
    const cache = useRef({
        carburetor: void 0,
        select: void 0,
        version: -1,
        value: void 0,
        filled: false
    });
    const pendingReads = useRef(new Set());
    const active = useRef(null);
    const notify = useRef(null);
    const install = useCallback(()=>{
        const onStoreChange = notify.current;
        if (!onStoreChange) return;
        const reads = pendingReads.current;
        const current = active.current;
        if (current && current.carburetor === carburetor && sameReads(current.reads, reads)) return;
        if (current) current.carburetor.unsubscribe(current.id);
        const id = carburetor.subscribe(onStoreChange, {
            reads
        });
        active.current = {
            carburetor,
            id,
            reads
        };
    }, [
        carburetor
    ]);
    const subscribe = useCallback((onStoreChange)=>{
        notify.current = ()=>{
            onStoreChange();
            install();
        };
        install();
        return ()=>{
            const current = active.current;
            if (current) {
                current.carburetor.unsubscribe(current.id);
                active.current = null;
            }
        };
    }, [
        install
    ]);
    const getSnapshot = useCallback(()=>{
        const entry = cache.current;
        const version = carburetor.getVersion();
        if (entry.filled && entry.carburetor === carburetor && entry.select === select && entry.version === version) return entry.value;
        const reads = new Set();
        let next = select(carburetor.read((path)=>reads.add(path)));
        if (isTrackable(next)) next = deepClone(next);
        else if (isExoticValue(next)) next = snapshotOpaque(next);
        pendingReads.current = reads;
        if (entry.filled && isEqual(entry.value, next)) {
            cache.current = {
                carburetor,
                select,
                version,
                value: entry.value,
                filled: true
            };
            return entry.value;
        }
        cache.current = {
            carburetor,
            select,
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
    useLayoutEffect(()=>{
        install();
    });
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
export { useCarburetorValue };
