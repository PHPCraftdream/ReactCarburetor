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
    useComputedValue: ()=>useComputedValue
});
const external_react_namespaceObject = require("react");
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
    const subscribe = (0, external_react_namespaceObject.useCallback)((onStoreChange)=>{
        const id = computed.subscribe(onStoreChange);
        return ()=>computed.unsubscribe(id);
    }, [
        computed
    ]);
    const getSnapshot = (0, external_react_namespaceObject.useCallback)(()=>readSnapshot(computed), [
        computed
    ]);
    return (0, external_react_namespaceObject.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot).value;
};
exports.useComputedValue = __webpack_exports__.useComputedValue;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "useComputedValue"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
