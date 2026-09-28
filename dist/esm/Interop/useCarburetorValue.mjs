"use client";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { detachOpaque } from "../Carburetor/Store/Utils/detachOpaque.mjs";
import { sameSelection } from "../Carburetor/Component/Connection/sameSelection.mjs";
import { isTrackable } from "../Carburetor/Store/Tracking/isTrackable.mjs";
const sameReads = (a, b)=>{
    if (a.size !== b.size) return false;
    for (const path of a)if (!b.has(path)) return false;
    return true;
};
const resolveView = (cached, carburetor, record)=>{
    const data = carburetor.getData();
    if (null !== cached && cached.carburetor === carburetor && cached.data === data && isTrackable(data)) return cached;
    return {
        carburetor,
        data,
        view: carburetor.read(record)
    };
};
const describeInstance = (instance)=>{
    var _Object_getPrototypeOf_constructor, _Object_getPrototypeOf;
    return (null == (_Object_getPrototypeOf = Object.getPrototypeOf(instance)) ? void 0 : null == (_Object_getPrototypeOf_constructor = _Object_getPrototypeOf.constructor) ? void 0 : _Object_getPrototypeOf_constructor.name) || 'class';
};
const detach = (value)=>{
    if (null === value || 'object' != typeof value) return value;
    return detachOpaque(value, (instance)=>{
        throw new Error('useCarburetorValue() cannot select a live ' + describeInstance(instance) + " instance because in-place changes cannot produce a safe React snapshot. Select the fields the component renders or return a plain object of those fields.");
    });
};
const useCarburetorValue = (carburetor, select, isEqual = sameSelection)=>{
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
    const view = useRef(null);
    const currentReads = useRef(void 0);
    const recordRead = useCallback((path)=>{
        var _currentReads_current;
        null == (_currentReads_current = currentReads.current) || _currentReads_current.add(path);
    }, []);
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
        view.current = resolveView(view.current, carburetor, recordRead);
        const reads = new Set();
        currentReads.current = reads;
        let result;
        try {
            const fresh = select(view.current.view);
            pendingReads.current = reads;
            const liveCompare = isEqual === sameSelection;
            const candidate = liveCompare ? fresh : detach(fresh);
            result = entry.filled && isEqual(entry.value, candidate) ? entry.value : liveCompare ? detach(fresh) : candidate;
        } finally{
            currentReads.current = void 0;
        }
        cache.current = {
            carburetor,
            select,
            version,
            value: result,
            filled: true
        };
        return result;
    }, [
        carburetor,
        select,
        isEqual,
        recordRead
    ]);
    useLayoutEffect(()=>{
        install();
    });
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
export { useCarburetorValue };
