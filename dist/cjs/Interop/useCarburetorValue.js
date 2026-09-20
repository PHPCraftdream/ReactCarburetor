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
const useCarburetorValue = (carburetor, select, isEqual = Object.is)=>{
    const cache = (0, external_react_namespaceObject.useRef)({
        version: -1,
        value: void 0,
        filled: false
    });
    const subscribe = (0, external_react_namespaceObject.useCallback)((onStoreChange)=>{
        const reads = new Set();
        select(carburetor.read((path)=>reads.add(path)));
        const id = carburetor.subscribe(onStoreChange, {
            reads
        });
        return ()=>carburetor.unsubscribe(id);
    }, [
        carburetor,
        select
    ]);
    const getSnapshot = (0, external_react_namespaceObject.useCallback)(()=>{
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
    return (0, external_react_namespaceObject.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
};
exports.useCarburetorValue = __webpack_exports__.useCarburetorValue;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "useCarburetorValue"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
