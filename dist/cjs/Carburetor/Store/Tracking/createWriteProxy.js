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
const Paths_js_namespaceObject = require("../../Models/Paths.js");
const diffPaths_js_namespaceObject = require("../Paths/Diff/diffPaths.js");
const joinPath_js_namespaceObject = require("../Paths/joinPath.js");
const KeysMarker_js_namespaceObject = require("../Paths/Markers/KeysMarker.js");
const deepClone_js_namespaceObject = require("../Utils/deepClone.js");
const external_createProxyCache_js_namespaceObject = require("./createProxyCache.js");
const external_Models_js_namespaceObject = require("./Models.js");
const external_isTrackable_js_namespaceObject = require("./isTrackable.js");
const patchValue = (value)=>(0, external_isTrackable_js_namespaceObject.isTrackable)(value) ? (0, deepClone_js_namespaceObject.deepClone)(value) : value;
const proxyTargets = new WeakMap();
const unwrapWriteProxy = (value)=>{
    if (null === value || 'object' != typeof value) return value;
    const target = proxyTargets.get(value);
    return target ?? value;
};
const forbidSymbolKey = (path)=>{
    throw new Error('Carburetor: "' + (path || 'the root') + '" cannot take a symbol-keyed write — state is string-keyed data only. Use a string key.');
};
const isOpaqueDescriptor = (descriptor, wasOwn)=>'get' in descriptor || 'set' in descriptor || false === descriptor.configurable || false === descriptor.writable || false === descriptor.enumerable || !wasOwn && true !== descriptor.enumerable;
class WriteProxyHandler {
    basePath;
    record;
    aliases;
    cache;
    isArray;
    patchPort;
    basePathSegments;
    constructor(basePath, record, aliases, cache, isArray, patchPort, basePathSegments){
        this.basePath = basePath;
        this.record = record;
        this.aliases = aliases;
        this.cache = cache;
        this.isArray = isArray;
        this.patchPort = patchPort;
        this.basePathSegments = basePathSegments;
    }
    childPaths;
    keysMarkerPath;
    keysMarker() {
        return this.keysMarkerPath ?? (this.keysMarkerPath = (0, KeysMarker_js_namespaceObject.keysPath)(this.basePath));
    }
    writtenPath(key) {
        const memo = this.childPaths ?? (this.childPaths = new Map());
        let path = memo.get(key);
        if (void 0 === path) {
            path = (0, joinPath_js_namespaceObject.joinPath)(this.basePath, key);
            memo.set(key, path);
        }
        return path;
    }
    reportPatch(listener, key, previous, next) {
        listener({
            segments: [
                ...this.basePathSegments,
                key
            ],
            previous: patchValue(previous),
            next: patchValue(next)
        });
    }
    wrap(path, key, source) {
        const cached = this.cache.get(path, source);
        if (void 0 !== cached) return cached;
        const segments = [
            ...this.basePathSegments,
            key
        ];
        const proxy = createWriteProxy(source, this.record, path, this.aliases, this.cache, this.patchPort, segments);
        this.cache.set(path, source, proxy);
        return proxy;
    }
    get(source, key) {
        if ('symbol' == typeof key) return key === external_Models_js_namespaceObject.PROXY_CACHE ? this.cache : Reflect.get(source, key);
        const value = Reflect.get(source, key);
        if ('function' == typeof value) return value;
        if ((0, external_isTrackable_js_namespaceObject.isTrackable)(value)) return this.wrap(this.writtenPath(key), key, value);
        if (null !== value && 'object' == typeof value) {
            var _this_patchPort_listener, _this_patchPort;
            null == (_this_patchPort = this.patchPort) || null == (_this_patchPort_listener = _this_patchPort.listener) || _this_patchPort_listener.call(_this_patchPort, Paths_js_namespaceObject.PATCH_OPAQUE);
            this.record(this.writtenPath(key));
        }
        return value;
    }
    set(source, key, value) {
        var _this_aliases, _this_aliases1, _this_aliases2, _this_aliases3, _this_patchPort;
        if ('symbol' == typeof key) return forbidSymbolKey(this.basePath);
        const previous = Reflect.get(source, key);
        const raw = unwrapWriteProxy(value);
        const wasOwn = Object.prototype.hasOwnProperty.call(source, key);
        if (wasOwn && Object.is(previous, raw)) return true;
        const path = this.writtenPath(key);
        null == (_this_aliases = this.aliases) || _this_aliases.checkKey(source, key, path);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.checkState(raw, path, wasOwn ? previous : void 0);
        null == (_this_aliases2 = this.aliases) || _this_aliases2.checkWrite(source, this.basePath);
        null == (_this_aliases3 = this.aliases) || _this_aliases3.forget(previous);
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        if (!wasOwn) this.record(this.keysMarker());
        if (this.isArray && 'length' === key && 'number' == typeof raw && 'number' == typeof previous && raw < previous) {
            for(let removed = raw; removed < previous; removed++){
                const removedKey = String(removed);
                const removedPath = (0, joinPath_js_namespaceObject.joinPath)(this.basePath, removedKey);
                if (listener) this.reportPatch(listener, removedKey, Reflect.get(source, removedKey), Paths_js_namespaceObject.PATCH_ABSENT);
                this.record(removedPath);
            }
            this.record(this.keysMarker());
        }
        const previousLength = this.isArray && 'length' !== key ? source.length : void 0;
        if (wasOwn && (0, external_isTrackable_js_namespaceObject.isTrackable)(previous) && (0, external_isTrackable_js_namespaceObject.isTrackable)(raw) && Array.isArray(previous) === Array.isArray(raw)) {
            const segments = listener ? [
                ...this.basePathSegments,
                key
            ] : [];
            (0, diffPaths_js_namespaceObject.diffPaths)(previous, raw, path, segments, listener).forEach((changed)=>this.record(changed));
        } else {
            if (listener) this.reportPatch(listener, key, wasOwn ? previous : Paths_js_namespaceObject.PATCH_ABSENT, raw);
            this.record(path);
        }
        const wrote = Reflect.set(source, key, raw);
        if (void 0 !== previousLength && source.length !== previousLength) {
            const newLength = source.length;
            if (listener) this.reportPatch(listener, 'length', previousLength, newLength);
            this.record(this.writtenPath('length'));
        }
        return wrote;
    }
    defineProperty(source, key, descriptor) {
        var _this_aliases, _this_aliases1, _this_aliases2, _this_aliases3, _this_patchPort;
        if ('symbol' == typeof key) return forbidSymbolKey(this.basePath);
        const wasOwn = Object.prototype.hasOwnProperty.call(source, key);
        if (isOpaqueDescriptor(descriptor, wasOwn)) throw new Error('Carburetor: "' + (0, joinPath_js_namespaceObject.joinPath)(this.basePath, key) + '" cannot take a non-plain-data descriptor — state properties are writable, configurable, enumerable data, no accessors. Derive a computed value instead, e.g. with Computed.');
        const previous = Reflect.get(source, key);
        const path = this.writtenPath(key);
        null == (_this_aliases = this.aliases) || _this_aliases.checkKey(source, key, path);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.checkState(descriptor.value, path, wasOwn ? previous : void 0);
        null == (_this_aliases2 = this.aliases) || _this_aliases2.checkWrite(source, this.basePath);
        null == (_this_aliases3 = this.aliases) || _this_aliases3.forget(previous);
        if (!wasOwn) this.record(this.keysMarker());
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        if (listener) this.reportPatch(listener, key, wasOwn ? previous : Paths_js_namespaceObject.PATCH_ABSENT, descriptor.value);
        this.record(path);
        return Reflect.defineProperty(source, key, descriptor);
    }
    deleteProperty(source, key) {
        var _this_aliases, _this_aliases1, _this_patchPort;
        if (!Reflect.has(source, key)) return true;
        if ('symbol' == typeof key) return forbidSymbolKey(this.basePath);
        const previous = Reflect.get(source, key);
        null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.forget(previous);
        this.record(this.keysMarker());
        const path = this.writtenPath(key);
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        if (listener) this.reportPatch(listener, key, previous, Paths_js_namespaceObject.PATCH_ABSENT);
        this.record(path);
        return Reflect.deleteProperty(source, key);
    }
}
const createWriteProxy = (target, record, basePath = '', aliases, cache, patchPort, basePathSegments = [])=>{
    const cached = cache ?? (0, external_createProxyCache_js_namespaceObject.createProxyCache)();
    const handler = new WriteProxyHandler(basePath, record, aliases, cached, Array.isArray(target), patchPort, basePathSegments);
    const proxy = new Proxy(target, handler);
    proxyTargets.set(proxy, target);
    return proxy;
};
exports.createWriteProxy = __webpack_exports__.createWriteProxy;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createWriteProxy"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
