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
const BranchMarker_js_namespaceObject = require("../Paths/BranchMarker.js");
const WildcardPath_js_namespaceObject = require("../Paths/WildcardPath.js");
const DevelopmentFlag_js_namespaceObject = require("../Utils/DevelopmentFlag.js");
const external_createProxyCache_js_namespaceObject = require("./createProxyCache.js");
const external_Models_js_namespaceObject = require("./Models.js");
const external_liveViews_js_namespaceObject = require("./liveViews.js");
const external_isTrackable_js_namespaceObject = require("./isTrackable.js");
const createReadProxy = (target, record, basePath = '', aliases)=>{
    const cached = (0, external_createProxyCache_js_namespaceObject.createProxyCache)(target);
    const forbidWrite = ()=>{
        throw new Error("Carburetor: data read through useCarburetor is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
    };
    const lockedError = (path)=>new Error('Carburetor: read-only tracking cannot wrap "' + path + '" — the property is non-configurable and non-writable (freeze or seal does this), and the engine accepts only the raw object there, which nothing would track or guard. Keep store data unfrozen; snapshot() is the detached form.');
    const lockedAgainstWrapping = (source, key, own)=>{
        const descriptor = own ?? (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT || !Object.isExtensible(source) ? Reflect.getOwnPropertyDescriptor(source, key) : void 0);
        return void 0 !== descriptor && !descriptor.configurable && false === descriptor.writable;
    };
    const proxy = new Proxy(target, {
        get: (source, key)=>{
            if (key === external_Models_js_namespaceObject.PROXY_CACHE) return cached;
            cached.sweep();
            const value = Reflect.get(source, key, proxy);
            if ('symbol' == typeof key) return value;
            const path = (0, joinPath_js_namespaceObject.joinPath)(basePath, key);
            if ((0, external_isTrackable_js_namespaceObject.isTrackable)(value)) {
                aliases?.note(value, path);
                record((0, BranchMarker_js_namespaceObject.branchPath)(path));
                if (lockedAgainstWrapping(source, key)) {
                    if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT) throw lockedError(path);
                    return value;
                }
                return cached(path, value, ()=>createReadProxy(value, record, path, aliases));
            }
            record(path);
            return value;
        },
        has: (source, key)=>{
            cached.sweep();
            if ('string' == typeof key) record((0, joinPath_js_namespaceObject.joinPath)(basePath, key));
            return Reflect.has(source, key);
        },
        ownKeys: (source)=>{
            cached.sweep();
            record(basePath || WildcardPath_js_namespaceObject.WILDCARD_PATH);
            return Reflect.ownKeys(source);
        },
        getOwnPropertyDescriptor: (source, key)=>{
            cached.sweep();
            const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
            if (void 0 === descriptor || 'symbol' == typeof key) return descriptor;
            const path = (0, joinPath_js_namespaceObject.joinPath)(basePath, key);
            const value = descriptor.value;
            if ((0, external_isTrackable_js_namespaceObject.isTrackable)(value)) {
                if (lockedAgainstWrapping(source, key, descriptor)) {
                    if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT) throw lockedError(path);
                    return descriptor;
                }
                descriptor.value = cached(path, value, ()=>createReadProxy(value, record, path, aliases));
            }
            return descriptor;
        },
        setPrototypeOf: forbidWrite,
        preventExtensions: forbidWrite,
        set: forbidWrite,
        defineProperty: forbidWrite,
        deleteProperty: forbidWrite
    });
    external_liveViews_js_namespaceObject.liveViews.note(proxy);
    return proxy;
};
exports.createReadProxy = __webpack_exports__.createReadProxy;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createReadProxy"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
