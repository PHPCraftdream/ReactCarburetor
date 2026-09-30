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
const EResourceStatus_js_namespaceObject = require("../../Models/Enums/EResourceStatus.js");
const DiagnosticsInstance_js_namespaceObject = require("../../Store/Diagnostics/DiagnosticsInstance.js");
const joinPath_js_namespaceObject = require("../../Store/Paths/joinPath.js");
const PathSeparator_js_namespaceObject = require("../../Store/Paths/PathSeparator.js");
const WildcardPath_js_namespaceObject = require("../../Store/Paths/WildcardPath.js");
const external_escapeCacheKey_js_namespaceObject = require("./escapeCacheKey.js");
const external_getInitialCacheEntry_js_namespaceObject = require("./getInitialCacheEntry.js");
const external_ResourceCacheLifecycle_js_namespaceObject = require("./ResourceCacheLifecycle.js");
const external_isViewCurrent_js_namespaceObject = require("./isViewCurrent.js");
const ABSENT_VIEW = Object.freeze({
    ...(0, external_getInitialCacheEntry_js_namespaceObject.getInitialCacheEntry)(),
    stale: true
});
const ENTRY_PATH_PREFIX = `entries${PathSeparator_js_namespaceObject.PATH_SEPARATOR}`;
const validateOptions = (options)=>{
    if (void 0 !== options.ttl && (Number.isNaN(options.ttl) || options.ttl < 0)) throw new RangeError('ResourceCache ttl must be a non-negative number');
    if (void 0 !== options.maxEntries && 1 / 0 !== options.maxEntries && (!Number.isInteger(options.maxEntries) || options.maxEntries < 0)) throw new RangeError('ResourceCache maxEntries must be a non-negative integer or Infinity');
    return options;
};
class ResourceCache extends external_ResourceCacheLifecycle_js_namespaceObject.ResourceCacheLifecycle {
    lastKeyArgs = void 0;
    lastKeyJson = void 0;
    lastKeyValue = void 0;
    keyMutationReported = false;
    constructor(loader, options = {}){
        super(loader, validateOptions(options));
    }
    didSetData() {
        const keys = Object.keys(this.data.entries);
        this.eviction.replace(keys);
        this.viewCache.forEach((_view, key)=>{
            if (!Object.prototype.hasOwnProperty.call(this.data.entries, key)) this.viewCache.delete(key);
        });
        this.failures.forEach((failure, key)=>{
            if (failure.entry !== this.data.entries[key]) this.failures.delete(key);
        });
    }
    preEmit() {
        if (0 === this.failures.size || 0 === this.writes.size && this.draftTouched) return;
        if (0 === this.writes.size || this.writes.has(WildcardPath_js_namespaceObject.WILDCARD_PATH) || this.writes.has('entries')) this.failures.forEach(this.reconcileFailure, this);
        else this.writes.forEach(this.reconcileFailureWrite, this);
    }
    reconcileFailure(failure, key) {
        const entry = this.data.entries[key];
        if (entry === failure.entry && failure.status === EResourceStatus_js_namespaceObject.EResourceStatus.Error && void 0 === entry.error && (entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Pending && this.requests.has(key) || entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Idle && entry.failed)) return;
        if (!entry || entry !== failure.entry || entry.status !== failure.status || entry.error !== failure.error) this.failures.delete(key);
    }
    reconcileFailureWrite(path) {
        if (!path.startsWith(ENTRY_PATH_PREFIX)) return;
        const end = path.indexOf(PathSeparator_js_namespaceObject.PATH_SEPARATOR, ENTRY_PATH_PREFIX.length);
        const escaped = path.slice(ENTRY_PATH_PREFIX.length, -1 === end ? void 0 : end);
        const key = escaped.includes('~') ? escaped.replace(/~1/g, PathSeparator_js_namespaceObject.PATH_SEPARATOR).replace(/~0/g, '~') : escaped;
        const failure = this.failures.get(key);
        if (failure) this.reconcileFailure(failure, key);
    }
    keyOf(args) {
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
    }
    pathOf(args) {
        return this.pathOfKey(this.keyOf(args));
    }
    pathOfKey(key) {
        return (0, joinPath_js_namespaceObject.joinPath)('entries', key);
    }
    getEntry(args) {
        return this.getEntryByKey(this.keyOf(args));
    }
    getEntryByKey(key) {
        const stored = this.data.entries[key];
        if (!stored) return ABSENT_VIEW;
        this.touch(key);
        const stale = this.isStale(stored);
        const cached = this.viewCache.get(key);
        if (cached && (0, external_isViewCurrent_js_namespaceObject.isViewCurrent)(cached, stored, stale)) return cached;
        const view = {
            ...stored,
            stale
        };
        this.viewCache.set(key, view);
        return view;
    }
    fromJSON(value) {
        this.restore(value);
    }
    resolve(args) {
        const key = this.keyOf(args);
        return {
            key,
            path: this.pathOfKey(key),
            view: this.getEntryByKey(key)
        };
    }
    getFailure(args) {
        const key = this.keyOf(args);
        const failure = this.failures.get(key);
        if (failure && failure.entry !== this.data.entries[key]) return void this.failures.delete(key);
        return null == failure ? void 0 : failure.value;
    }
}
exports.ResourceCache = __webpack_exports__.ResourceCache;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "ResourceCache"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
