import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { diagnostics } from "../Carburetor/Store/Diagnostics/DiagnosticsInstance.mjs";
import { detachOpaque } from "../Carburetor/Store/Utils/detachOpaque.mjs";
import { IS_DEVELOPMENT } from "../Carburetor/Store/Utils/DevelopmentFlag.mjs";
const sameReads = (a, b)=>{
    if (a.size !== b.size) return false;
    for (const path of a)if (!b.has(path)) return false;
    return true;
};
const describeInstance = (instance)=>{
    var _Object_getPrototypeOf_constructor, _Object_getPrototypeOf;
    return (null == (_Object_getPrototypeOf = Object.getPrototypeOf(instance)) ? void 0 : null == (_Object_getPrototypeOf_constructor = _Object_getPrototypeOf.constructor) ? void 0 : _Object_getPrototypeOf_constructor.name) || 'untracked class';
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
    const liveInstanceReported = useRef(false);
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
        if (null !== next && 'object' == typeof next) {
            const reportLiveInstance = IS_DEVELOPMENT && !liveInstanceReported.current ? (instance)=>{
                liveInstanceReported.current = true;
                diagnostics.report('useCarburetorValue() handed React a live ' + describeInstance(instance) + " instance. A class instance has no safe copy, so the same object is handed out again after every store change and an in-place mutation is certified as unchanged — the component renders stale data. Select plain values instead: the fields the component renders, or a plain object built from them.");
            } : void 0;
            next = detachOpaque(next, reportLiveInstance);
        }
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
