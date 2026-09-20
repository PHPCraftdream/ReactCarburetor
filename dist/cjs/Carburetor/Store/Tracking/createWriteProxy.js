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
    createWriteProxy: ()=>createWriteProxy
});
const joinPath_js_namespaceObject = require("../Paths/joinPath.js");
const WildcardPath_js_namespaceObject = require("../Paths/WildcardPath.js");
const external_createProxyCache_js_namespaceObject = require("./createProxyCache.js");
const external_isTrackable_js_namespaceObject = require("./isTrackable.js");
const createWriteProxy = (target, record, basePath = '')=>{
    const cached = (0, external_createProxyCache_js_namespaceObject.createProxyCache)();
    const isArray = Array.isArray(target);
    const writtenPath = (key)=>{
        if ('symbol' == typeof key) return WildcardPath_js_namespaceObject.WILDCARD_PATH;
        return isArray ? basePath || WildcardPath_js_namespaceObject.WILDCARD_PATH : (0, joinPath_js_namespaceObject.joinPath)(basePath, key);
    };
    return new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key);
            if ('symbol' == typeof key || 'function' == typeof value) return value;
            const path = (0, joinPath_js_namespaceObject.joinPath)(basePath, key);
            if ((0, external_isTrackable_js_namespaceObject.isTrackable)(value)) return cached(path, value, ()=>createWriteProxy(value, record, path));
            if (null !== value && 'object' == typeof value) record(path);
            return value;
        },
        set: (source, key, value)=>{
            if (Reflect.get(source, key) === value) return true;
            record(writtenPath(key));
            return Reflect.set(source, key, value);
        },
        defineProperty: (source, key, descriptor)=>{
            record(writtenPath(key));
            return Reflect.defineProperty(source, key, descriptor);
        },
        deleteProperty: (source, key)=>{
            if (!Reflect.has(source, key)) return true;
            record(writtenPath(key));
            return Reflect.deleteProperty(source, key);
        }
    });
};
exports.createWriteProxy = __webpack_exports__.createWriteProxy;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createWriteProxy"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
