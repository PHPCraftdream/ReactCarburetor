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
    createProxyCache: ()=>createProxyCache
});
const PathSeparator_js_namespaceObject = require("../Paths/PathSeparator.js");
const WildcardPath_js_namespaceObject = require("../Paths/WildcardPath.js");
const scopes = new WeakMap();
const covers = (invalidated, key)=>{
    if (invalidated === WildcardPath_js_namespaceObject.WILDCARD_PATH || '' === invalidated) return true;
    return key === invalidated || key.startsWith(invalidated + PathSeparator_js_namespaceObject.PATH_SEPARATOR);
};
const createProxyCache = (target)=>{
    const scope = scopes.get(target) ?? {
        revision: 0,
        invalidations: new Map()
    };
    scopes.set(target, scope);
    const entries = new Map();
    let syncedAt = scope.revision;
    const sync = ()=>{
        if (syncedAt === scope.revision) return;
        for (const [path, entry] of entries)for (const [invalidated, revision] of scope.invalidations)if (revision > entry.revision && covers(invalidated, path)) {
            entries.delete(path);
            break;
        }
        syncedAt = scope.revision;
    };
    const cache = (path, source, create)=>{
        sync();
        const entry = entries.get(path);
        if (entry && entry.source === source) return entry.proxy;
        const proxy = create();
        entries.set(path, {
            source,
            proxy,
            revision: scope.revision
        });
        return proxy;
    };
    cache.invalidate = (path)=>{
        scope.revision++;
        scope.invalidations.set(path, scope.revision);
    };
    cache.owns = (path, source)=>{
        const entry = entries.get(path);
        return void 0 !== entry && entry.source === source;
    };
    cache.size = ()=>entries.size;
    return cache;
};
exports.createProxyCache = __webpack_exports__.createProxyCache;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createProxyCache"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
