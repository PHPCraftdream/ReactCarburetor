"use strict";
"use client";
var __webpack_require__ = {};
(()=>{
    __webpack_require__.d = (exports1, getters, values)=>{
        var define = (defs, kind)=>{
            for(var key in defs)if (__webpack_require__.o(defs, key) && !__webpack_require__.o(exports1, key)) Object.defineProperty(exports1, key, {
                enumerable: true,
                [kind]: defs[key]
            });
        };
        define(getters, "get");
        define(values, "value");
    };
})();
(()=>{
    __webpack_require__.o = (obj, prop)=>Object.prototype.hasOwnProperty.call(obj, prop);
})();
(()=>{
    __webpack_require__.r = (exports1)=>{
        if ("u" > typeof Symbol && Symbol.toStringTag) Object.defineProperty(exports1, Symbol.toStringTag, {
            value: 'Module'
        });
        Object.defineProperty(exports1, '__esModule', {
            value: true
        });
    };
})();
var __webpack_exports__ = {};
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
    useCarburetorValue: ()=>useCarburetorValue
});
const external_react_namespaceObject = require("react");
const detachOpaque_js_namespaceObject = require("../Carburetor/Store/Utils/detachOpaque.js");
const sameSelection_js_namespaceObject = require("../Carburetor/Component/Connection/sameSelection.js");
const isTrackable_js_namespaceObject = require("../Carburetor/Store/Tracking/isTrackable.js");
const sameReads = (a, b)=>{
    if (a.size !== b.size) return false;
    for (const path of a)if (!b.has(path)) return false;
    return true;
};
const resolveView = (cached, carburetor, record)=>{
    const data = carburetor.getData();
    if (null !== cached && cached.carburetor === carburetor && cached.data === data && (0, isTrackable_js_namespaceObject.isTrackable)(data)) return cached;
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
    return (0, detachOpaque_js_namespaceObject.detachOpaque)(value, (instance)=>{
        throw new Error('useCarburetorValue() cannot select a live ' + describeInstance(instance) + " instance because in-place changes cannot produce a safe React snapshot. Select the fields the component renders or return a plain object of those fields.");
    });
};
const useCarburetorValue = (carburetor, select, isEqual = sameSelection_js_namespaceObject.sameSelection)=>{
    const cache = (0, external_react_namespaceObject.useRef)({
        carburetor: void 0,
        select: void 0,
        version: -1,
        value: void 0,
        filled: false
    });
    const pendingReads = (0, external_react_namespaceObject.useRef)(new Set());
    const active = (0, external_react_namespaceObject.useRef)(null);
    const notify = (0, external_react_namespaceObject.useRef)(null);
    const view = (0, external_react_namespaceObject.useRef)(null);
    const currentReads = (0, external_react_namespaceObject.useRef)(void 0);
    const recordRead = (0, external_react_namespaceObject.useCallback)((path)=>{
        var _currentReads_current;
        null == (_currentReads_current = currentReads.current) || _currentReads_current.add(path);
    }, []);
    const install = (0, external_react_namespaceObject.useCallback)(()=>{
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
    const subscribe = (0, external_react_namespaceObject.useCallback)((onStoreChange)=>{
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
    const getSnapshot = (0, external_react_namespaceObject.useCallback)(()=>{
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
            const liveCompare = isEqual === sameSelection_js_namespaceObject.sameSelection;
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
    (0, external_react_namespaceObject.useLayoutEffect)(()=>{
        install();
    });
    return (0, external_react_namespaceObject.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
};
exports.useCarburetorValue = __webpack_exports__.useCarburetorValue;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "useCarburetorValue"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
