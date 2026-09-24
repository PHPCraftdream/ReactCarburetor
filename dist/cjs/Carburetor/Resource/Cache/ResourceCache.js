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
    ResourceCache: ()=>ResourceCache
});
const DiagnosticsInstance_js_namespaceObject = require("../../Store/Diagnostics/DiagnosticsInstance.js");
const joinPath_js_namespaceObject = require("../../Store/Paths/joinPath.js");
const external_escapeCacheKey_js_namespaceObject = require("./escapeCacheKey.js");
const external_getInitialCacheEntry_js_namespaceObject = require("./getInitialCacheEntry.js");
const external_ResourceCacheLifecycle_js_namespaceObject = require("./ResourceCacheLifecycle.js");
class ResourceCache extends external_ResourceCacheLifecycle_js_namespaceObject.ResourceCacheLifecycle {
    lastKeyArgs = void 0;
    lastKeyJson = void 0;
    lastKeyValue = void 0;
    keyMutationReported = false;
    constructor(loader, options = {}){
        super(loader, options);
    }
    keyOf = (args)=>{
        const json = JSON.stringify(void 0 === args ? null : args);
        const memoized = this.lastKeyArgs === args && void 0 !== this.lastKeyValue;
        if (memoized && this.lastKeyJson === json && void 0 !== this.lastKeyValue) return this.lastKeyValue;
        const key = (0, external_escapeCacheKey_js_namespaceObject.escapeCacheKey)(json);
        const development = "u" > typeof process && 'production' !== process.env.NODE_ENV;
        if (memoized && development && !this.keyMutationReported) {
            this.keyMutationReported = true;
            DiagnosticsInstance_js_namespaceObject.diagnostics.report(`a resource arguments object was mutated after its key was taken: the same reference now encodes to a different entry (${this.lastKeyValue} became ${key}), and the new key is the one being used. Build a fresh object per query rather than mutating one in place.`);
        }
        this.lastKeyArgs = args;
        this.lastKeyJson = json;
        this.lastKeyValue = key;
        return key;
    };
    pathOf = (args)=>(0, joinPath_js_namespaceObject.joinPath)('entries', this.keyOf(args));
    getEntry = (args)=>{
        const key = this.keyOf(args);
        const stored = this.data.entries[key];
        if (!stored) return {
            ...(0, external_getInitialCacheEntry_js_namespaceObject.getInitialCacheEntry)(),
            stale: true
        };
        this.touch(key);
        const stale = this.isStale(stored);
        const cached = this.viewCache.get(key);
        if (cached && this.isViewCurrent(cached, stored, stale)) return cached;
        const view = {
            ...stored,
            stale
        };
        this.viewCache.set(key, view);
        return view;
    };
    getFailure = (args)=>this.failures.get(this.keyOf(args));
}
exports.ResourceCache = __webpack_exports__.ResourceCache;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "ResourceCache"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
