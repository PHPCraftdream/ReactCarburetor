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
const BranchMarker_js_namespaceObject = require("../Paths/Markers/BranchMarker.js");
const KeysMarker_js_namespaceObject = require("../Paths/Markers/KeysMarker.js");
const DevelopmentFlag_js_namespaceObject = require("../Utils/DevelopmentFlag.js");
const external_createProxyCache_js_namespaceObject = require("./createProxyCache.js");
const external_Models_js_namespaceObject = require("./Models.js");
const external_liveViews_js_namespaceObject = require("./liveViews.js");
const external_isTrackable_js_namespaceObject = require("./isTrackable.js");
const isRecordable = (source, key)=>Object.prototype.hasOwnProperty.call(source, key) || !(key in source);
const forbidWrite = ()=>{
    throw new Error("Carburetor: data read through useCarburetor is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
};
const lockedError = (path)=>new Error('Carburetor: read-only tracking cannot wrap "' + path + '" — the property is non-configurable and non-writable (freeze or seal does this), and the engine accepts only the raw object there, which nothing would track or guard. Keep store data unfrozen; snapshot() is the detached form.');
const lockedAgainstWrapping = (source, key, own)=>{
    const descriptor = own ?? (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT || !Object.isExtensible(source) ? Reflect.getOwnPropertyDescriptor(source, key) : void 0);
    return void 0 !== descriptor && !descriptor.configurable && false === descriptor.writable;
};
class ReadProxyHandler {
    basePath;
    record;
    aliases;
    cache;
    constructor(basePath, record, aliases, cache){
        this.basePath = basePath;
        this.record = record;
        this.aliases = aliases;
        this.cache = cache;
    }
    firstKey = void 0;
    firstPath = '';
    childPaths = void 0;
    firstBranch = void 0;
    firstMarker = '';
    branchMarkers = void 0;
    keysMarkerPath = void 0;
    childPath(key) {
        if (key === this.firstKey) return this.firstPath;
        if (void 0 === this.firstKey) {
            this.firstKey = key;
            this.firstPath = (0, joinPath_js_namespaceObject.joinPath)(this.basePath, key);
            return this.firstPath;
        }
        const memo = this.childPaths ?? (this.childPaths = new Map());
        let path = memo.get(key);
        if (void 0 === path) {
            path = (0, joinPath_js_namespaceObject.joinPath)(this.basePath, key);
            memo.set(key, path);
        }
        return path;
    }
    branchMarker(path) {
        if (path === this.firstBranch) return this.firstMarker;
        if (void 0 === this.firstBranch) {
            this.firstBranch = path;
            this.firstMarker = (0, BranchMarker_js_namespaceObject.branchPath)(path);
            return this.firstMarker;
        }
        const memo = this.branchMarkers ?? (this.branchMarkers = new Map());
        let marker = memo.get(path);
        if (void 0 === marker) {
            marker = (0, BranchMarker_js_namespaceObject.branchPath)(path);
            memo.set(path, marker);
        }
        return marker;
    }
    keysMarker() {
        return this.keysMarkerPath ?? (this.keysMarkerPath = (0, KeysMarker_js_namespaceObject.keysPath)(this.basePath));
    }
    wrap(path, source) {
        const cached = this.cache.get(path, source);
        if (void 0 !== cached) return cached;
        const proxy = createReadProxy(source, this.record, path, this.aliases, this.cache);
        this.cache.set(path, source, proxy);
        return proxy;
    }
    get(source, key, receiver) {
        if ('symbol' == typeof key) return key === external_Models_js_namespaceObject.PROXY_CACHE ? this.cache : Reflect.get(source, key, receiver);
        const value = Reflect.get(source, key, receiver);
        if (!isRecordable(source, key)) return value;
        const path = this.childPath(key);
        if ((0, external_isTrackable_js_namespaceObject.isTrackable)(value)) {
            var _this_aliases;
            null == (_this_aliases = this.aliases) || _this_aliases.note(value, path);
            this.record(this.branchMarker(path));
            if (lockedAgainstWrapping(source, key)) {
                if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT) throw lockedError(path);
                return value;
            }
            return this.wrap(path, value);
        }
        this.record(path);
        return value;
    }
    has(source, key) {
        const present = Reflect.has(source, key);
        if ('string' == typeof key && isRecordable(source, key)) {
            const path = this.childPath(key);
            const value = Reflect.get(source, key);
            this.record((0, external_isTrackable_js_namespaceObject.isTrackable)(value) ? this.branchMarker(path) : path);
        }
        return present;
    }
    ownKeys(source) {
        this.record(this.keysMarker());
        return Reflect.ownKeys(source);
    }
    getOwnPropertyDescriptor(source, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
        if (void 0 === descriptor || 'symbol' == typeof key) return descriptor;
        const path = this.childPath(key);
        const value = descriptor.value;
        if ((0, external_isTrackable_js_namespaceObject.isTrackable)(value)) {
            if (lockedAgainstWrapping(source, key, descriptor)) {
                if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT) throw lockedError(path);
                return descriptor;
            }
            descriptor.value = this.wrap(path, value);
        }
        return descriptor;
    }
    setPrototypeOf() {
        return forbidWrite();
    }
    preventExtensions() {
        return forbidWrite();
    }
    set() {
        return forbidWrite();
    }
    defineProperty() {
        return forbidWrite();
    }
    deleteProperty() {
        return forbidWrite();
    }
}
const createReadProxy = (target, record, basePath = '', aliases, cache)=>{
    const cached = cache ?? (0, external_createProxyCache_js_namespaceObject.createProxyCache)();
    const proxy = new Proxy(target, new ReadProxyHandler(basePath, record, aliases, cached));
    if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT) external_liveViews_js_namespaceObject.liveViews.note(proxy);
    return proxy;
};
exports.createReadProxy = __webpack_exports__.createReadProxy;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createReadProxy"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
