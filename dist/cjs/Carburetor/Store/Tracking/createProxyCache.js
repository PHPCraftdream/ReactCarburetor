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
const needsRecord = (state, record)=>{
    for (const [path, entry] of state.entries)if (entry.revision < record.revision && covers(record.path, path)) return true;
    return false;
};
const createProxyCache = (target)=>{
    const scope = scopes.get(target) ?? {
        revision: 0,
        records: new Map(),
        watchers: new Set(),
        visitedRecords: 0
    };
    scopes.set(target, scope);
    const state = {
        syncedAt: scope.revision,
        entries: new Map()
    };
    const watcherRef = new WeakRef(state);
    scope.watchers.add(watcherRef);
    const retire = (precise)=>{
        for (const watcher of scope.watchers)if (void 0 === watcher.deref()) scope.watchers.delete(watcher);
        let sweptThrough = scope.revision;
        for (const watcher of scope.watchers){
            const watched = watcher.deref();
            if (void 0 !== watched && watched.syncedAt < sweptThrough) sweptThrough = watched.syncedAt;
        }
        for (const [path, record] of scope.records){
            scope.visitedRecords++;
            if (record.revision <= sweptThrough) {
                scope.records.delete(path);
                continue;
            }
            if (!precise) continue;
            let stillNeeded = false;
            for (const watcher of scope.watchers){
                const watched = watcher.deref();
                if (void 0 !== watched && watched.syncedAt < record.revision && needsRecord(watched, record)) {
                    stillNeeded = true;
                    break;
                }
            }
            if (!stillNeeded) scope.records.delete(path);
        }
    };
    retire(false);
    const sweep = ()=>{
        if (state.syncedAt === scope.revision) return;
        const applied = state.syncedAt;
        state.syncedAt = scope.revision;
        for (const record of scope.records.values())if (!(record.revision <= applied)) {
            for (const [path, entry] of state.entries)if (entry.revision < record.revision && covers(record.path, path)) state.entries.delete(path);
        }
        retire(true);
    };
    const cache = (path, source, create)=>{
        sweep();
        const entry = state.entries.get(path);
        if (entry && entry.source === source) return entry.proxy;
        const proxy = create();
        state.entries.set(path, {
            source,
            proxy,
            revision: scope.revision
        });
        return proxy;
    };
    cache.invalidate = (path)=>{
        scope.revision++;
        scope.records.set(path, {
            path,
            revision: scope.revision
        });
        retire(false);
    };
    cache.sweep = sweep;
    cache.release = ()=>{
        scope.watchers.delete(watcherRef);
        retire(false);
    };
    cache.owns = (path, source)=>{
        const entry = state.entries.get(path);
        return void 0 !== entry && entry.source === source;
    };
    cache.size = ()=>state.entries.size;
    cache.pending = ()=>scope.records.size;
    cache.visitedRecords = ()=>scope.visitedRecords;
    cache.watcherCount = ()=>scope.watchers.size;
    return cache;
};
exports.createProxyCache = __webpack_exports__.createProxyCache;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createProxyCache"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
