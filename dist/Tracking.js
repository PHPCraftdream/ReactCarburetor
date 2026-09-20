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
    createReadProxy: ()=>createReadProxy,
    createWriteProxy: ()=>createWriteProxy,
    isTrackable: ()=>isTrackable
});
const external_Paths_js_namespaceObject = require("./Paths.js");
const isTrackable = (value)=>{
    if (null === value || 'object' != typeof value) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === Array.prototype || null === prototype;
};
const cachedProxy = (cache, path, source, create)=>{
    const entry = cache.get(path);
    if (entry && entry.source === source) return entry.proxy;
    const proxy = create();
    cache.set(path, {
        source,
        proxy
    });
    return proxy;
};
const createReadProxy = (target, record, basePath = '')=>{
    const cache = new Map();
    const forbidWrite = ()=>{
        throw new Error("Carburetor: data read through useCarburetor is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
    };
    return new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key);
            if ('symbol' == typeof key) return value;
            const path = (0, external_Paths_js_namespaceObject.joinPath)(basePath, key);
            if (isTrackable(value)) return cachedProxy(cache, path, value, ()=>createReadProxy(value, record, path));
            record(path);
            return value;
        },
        has: (source, key)=>{
            if ('string' == typeof key) record((0, external_Paths_js_namespaceObject.joinPath)(basePath, key));
            return Reflect.has(source, key);
        },
        ownKeys: (source)=>{
            record(basePath || external_Paths_js_namespaceObject.WILDCARD_PATH);
            return Reflect.ownKeys(source);
        },
        set: forbidWrite,
        deleteProperty: forbidWrite
    });
};
const createWriteProxy = (target, record, basePath = '')=>{
    const cache = new Map();
    const isArray = Array.isArray(target);
    const writtenPath = (key)=>isArray ? basePath || external_Paths_js_namespaceObject.WILDCARD_PATH : (0, external_Paths_js_namespaceObject.joinPath)(basePath, key);
    return new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key);
            if ('symbol' == typeof key || 'function' == typeof value || !isTrackable(value)) return value;
            const path = (0, external_Paths_js_namespaceObject.joinPath)(basePath, key);
            return cachedProxy(cache, path, value, ()=>createWriteProxy(value, record, path));
        },
        set: (source, key, value)=>{
            if ('string' == typeof key) {
                if (Reflect.get(source, key) === value) return true;
                record(writtenPath(key));
            }
            return Reflect.set(source, key, value);
        },
        deleteProperty: (source, key)=>{
            if ('string' == typeof key) {
                if (!Reflect.has(source, key)) return true;
                record(writtenPath(key));
            }
            return Reflect.deleteProperty(source, key);
        }
    });
};
exports.createReadProxy = __webpack_exports__.createReadProxy;
exports.createWriteProxy = __webpack_exports__.createWriteProxy;
exports.isTrackable = __webpack_exports__.isTrackable;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createReadProxy",
    "createWriteProxy",
    "isTrackable"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
