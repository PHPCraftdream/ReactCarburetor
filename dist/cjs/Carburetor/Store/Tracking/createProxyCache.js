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
const createProxyCache = ()=>{
    const entries = new Map();
    return (path, source, create)=>{
        const entry = entries.get(path);
        if (entry && entry.source === source) return entry.proxy;
        const proxy = create();
        entries.set(path, {
            source,
            proxy
        });
        return proxy;
    };
};
__webpack_require__.d(__webpack_exports__, {}, {
    createProxyCache: createProxyCache
});
exports.createProxyCache = __webpack_exports__.createProxyCache;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createProxyCache"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
