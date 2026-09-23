"use strict";
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
const DiagnosticsInstance_js_namespaceObject = require("../Carburetor/Store/Diagnostics/DiagnosticsInstance.js");
const detachOpaque_js_namespaceObject = require("../Carburetor/Store/Utils/detachOpaque.js");
const DevelopmentFlag_js_namespaceObject = require("../Carburetor/Store/Utils/DevelopmentFlag.js");
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
    const liveInstanceReported = (0, external_react_namespaceObject.useRef)(false);
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
        const reads = new Set();
        let next = select(carburetor.read((path)=>reads.add(path)));
        if (null !== next && 'object' == typeof next) {
            const reportLiveInstance = DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT && !liveInstanceReported.current ? (instance)=>{
                liveInstanceReported.current = true;
                DiagnosticsInstance_js_namespaceObject.diagnostics.report('useCarburetorValue() handed React a live ' + describeInstance(instance) + " instance. A class instance has no safe copy, so the same object is handed out again after every store change and an in-place mutation is certified as unchanged — the component renders stale data. Select plain values instead: the fields the component renders, or a plain object built from them.");
            } : void 0;
            next = (0, detachOpaque_js_namespaceObject.detachOpaque)(next, reportLiveInstance);
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
