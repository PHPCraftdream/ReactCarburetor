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
    createReadProxy: ()=>createReadProxy
});
const joinPath_js_namespaceObject = require("../Paths/joinPath.js");
const WildcardPath_js_namespaceObject = require("../Paths/WildcardPath.js");
const external_createProxyCache_js_namespaceObject = require("./createProxyCache.js");
const external_isTrackable_js_namespaceObject = require("./isTrackable.js");
const createReadProxy = (target, record, basePath = '')=>{
    const cached = (0, external_createProxyCache_js_namespaceObject.createProxyCache)();
    const forbidWrite = ()=>{
        throw new Error("Carburetor: data read through useCarburetor is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
    };
    return new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key);
            if ('symbol' == typeof key) return value;
            const path = (0, joinPath_js_namespaceObject.joinPath)(basePath, key);
            if ((0, external_isTrackable_js_namespaceObject.isTrackable)(value)) return cached(path, value, ()=>createReadProxy(value, record, path));
            record(path);
            return value;
        },
        has: (source, key)=>{
            if ('string' == typeof key) record((0, joinPath_js_namespaceObject.joinPath)(basePath, key));
            return Reflect.has(source, key);
        },
        ownKeys: (source)=>{
            record(basePath || WildcardPath_js_namespaceObject.WILDCARD_PATH);
            return Reflect.ownKeys(source);
        },
        set: forbidWrite,
        deleteProperty: forbidWrite
    });
};
exports.createReadProxy = __webpack_exports__.createReadProxy;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createReadProxy"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
