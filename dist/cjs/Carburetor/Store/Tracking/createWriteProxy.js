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
    setArrayLength(source, value, descriptor) {
        var _Object_getOwnPropertyDescriptor, _this_patchPort;
        const validNumber = 'number' == typeof value && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF;
        if (!descriptor && !validNumber && (null == (_Object_getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(source, 'length')) ? void 0 : _Object_getOwnPropertyDescriptor.writable) === false) return Reflect.set(source, 'length', value);
        const uint32 = validNumber ? value : value >>> 0;
        if (!validNumber && uint32 !== +value) throw new RangeError('Invalid array length');
        const array = source;
        const previousLength = array.length;
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        let removed;
        let removedValues;
        let removedAny = false;
        let denseStart;
        if (uint32 < previousLength) {
            const range = previousLength - uint32;
            if (!listener && range >= 64 && range <= 4096) {
                const ownKeys = Object.keys(array);
                if (ownKeys.length === previousLength && ownKeys[previousLength - 1] === String(previousLength - 1)) denseStart = uint32;
            }
            if (void 0 === denseStart) {
                removed = [];
                if (listener) removedValues = [];
                if (range <= 4096) {
                    for(let index = uint32; index < previousLength; index++)if (Object.prototype.hasOwnProperty.call(array, index)) {
                        removed.push(index);
                        null == removedValues || removedValues.push(array[index]);
                    }
                } else for (const key of Object.keys(array)){
                    const index = Number(key);
                    if (Number.isInteger(index) && index >= uint32 && index < previousLength && String(index) === key) {
                        removed.push(key);
                        null == removedValues || removedValues.push(array[index]);
                    }
                }
            }
        }
        const wrote = descriptor ? Reflect.defineProperty(source, 'length', {
            ...descriptor,
            value: uint32
        }) : Reflect.set(source, 'length', uint32);
        const nextLength = array.length;
        if (void 0 !== denseStart) {
            for(let index = denseStart; index < previousLength; index++)if (wrote || !Object.prototype.hasOwnProperty.call(array, index)) {
                removedAny = true;
                this.record((0, joinPath_js_namespaceObject.joinPath)(this.basePath, String(index)));
            }
        }
        if (removed) for(let i = 0; i < removed.length; i++){
            const entry = removed[i];
            if (!wrote && Object.prototype.hasOwnProperty.call(array, entry)) continue;
            removedAny = true;
            const key = String(entry);
            this.record((0, joinPath_js_namespaceObject.joinPath)(this.basePath, key));
            if (listener) this.reportPatch(listener, key, null == removedValues ? void 0 : removedValues[i], Paths_js_namespaceObject.PATCH_ABSENT);
        }
        if (removedAny) {
            var _this_aliases;
            null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
            this.record(this.keysMarker());
        }
        if (nextLength !== previousLength) {
            var _this_aliases1;
            null == (_this_aliases1 = this.aliases) || _this_aliases1.checkWrite(source, this.basePath);
            this.record(this.writtenPath('length'));
            if (listener) this.reportPatch(listener, 'length', previousLength, nextLength);
        }
        return wrote;
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
        if (this.isArray && 'length' === key) return this.setArrayLength(source, raw);
        if (wasOwn && Object.is(previous, raw)) return true;
        const path = this.writtenPath(key);
        null == (_this_aliases = this.aliases) || _this_aliases.checkKey(source, key, path);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.checkState(raw, path, wasOwn ? previous : void 0);
        null == (_this_aliases2 = this.aliases) || _this_aliases2.checkWrite(source, this.basePath);
        const protoWrite = '__proto__' === key;
        if (protoWrite && !Reflect.defineProperty(source, key, {
            value: raw,
            writable: true,
            enumerable: true,
            configurable: true
        })) return false;
        null == (_this_aliases3 = this.aliases) || _this_aliases3.forget(previous);
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        if (!wasOwn) this.record(this.keysMarker());
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
        const wrote = protoWrite || Reflect.set(source, key, raw);
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
        if (this.isArray && 'length' === key) return 'value' in descriptor ? this.setArrayLength(source, descriptor.value, descriptor) : Reflect.defineProperty(source, key, descriptor);
        const wasOwn = Object.prototype.hasOwnProperty.call(source, key);
        if (isOpaqueDescriptor(descriptor, wasOwn)) throw new Error('Carburetor: "' + (0, joinPath_js_namespaceObject.joinPath)(this.basePath, key) + '" cannot take a non-plain-data descriptor — state properties are writable, configurable, enumerable data, no accessors. Derive a computed value instead, e.g. with Computed.');
        const previous = Reflect.get(source, key);
        const raw = 'value' in descriptor ? unwrapWriteProxy(descriptor.value) : wasOwn ? previous : void 0;
        const path = this.writtenPath(key);
        null == (_this_aliases = this.aliases) || _this_aliases.checkKey(source, key, path);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.checkState(raw, path, wasOwn ? previous : void 0);
        null == (_this_aliases2 = this.aliases) || _this_aliases2.checkWrite(source, this.basePath);
        const effective = 'value' in descriptor ? {
            ...descriptor,
            value: raw
        } : descriptor;
        const previousLength = this.isArray ? source.length : void 0;
        const wrote = Reflect.defineProperty(source, key, effective);
        if (!wrote) return false;
        if (wasOwn && Object.is(previous, raw)) return true;
        null == (_this_aliases3 = this.aliases) || _this_aliases3.forget(previous);
        if (!wasOwn) this.record(this.keysMarker());
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        if (listener) this.reportPatch(listener, key, wasOwn ? previous : Paths_js_namespaceObject.PATCH_ABSENT, raw);
        this.record(path);
        if (void 0 !== previousLength && source.length !== previousLength) {
            const nextLength = source.length;
            if (listener) this.reportPatch(listener, 'length', previousLength, nextLength);
            this.record(this.writtenPath('length'));
        }
        return true;
    }
    deleteProperty(source, key) {
        var _this_aliases, _this_aliases1, _this_patchPort;
        if (!Object.prototype.hasOwnProperty.call(source, key)) return true;
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
