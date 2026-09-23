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
const index_js_namespaceObject = require("../Carburetor/index.js");
const isExoticValue_js_namespaceObject = require("../Carburetor/Store/Utils/isExoticValue.js");
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
            copy.set(key, (0, index_js_namespaceObject.deepClone)(member));
        });
        return copy;
    }
    if (value instanceof Set) {
        const copy = new Set();
        value.forEach((member)=>{
            copy.add((0, index_js_namespaceObject.deepClone)(member));
        });
        return copy;
    }
    return value;
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
        if ((0, index_js_namespaceObject.isTrackable)(next)) next = (0, index_js_namespaceObject.deepClone)(next);
        else if ((0, isExoticValue_js_namespaceObject.isExoticValue)(next)) next = snapshotOpaque(next);
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
