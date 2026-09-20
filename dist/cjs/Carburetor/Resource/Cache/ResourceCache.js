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
const Carburetor_js_namespaceObject = require("../../Store/Carburetor.js");
const PathSeparator_js_namespaceObject = require("../../Store/Paths/PathSeparator.js");
const external_describeError_js_namespaceObject = require("../describeError.js");
const external_encodeCacheKey_js_namespaceObject = require("./encodeCacheKey.js");
const external_getInitialCacheEntry_js_namespaceObject = require("./getInitialCacheEntry.js");
const DEFAULT_TTL = 30000;
const DEFAULT_MAX_ENTRIES = 100;
class ResourceCache extends Carburetor_js_namespaceObject.Carburetor {
    loader;
    ttl;
    maxEntries;
    requests = new Map();
    controllers = new Map();
    failures = new Map();
    lastUsed = new Map();
    useTick = 0;
    constructor(loader, options = {}){
        super({
            entries: {}
        }, options.scheduler), this.loader = loader;
        this.ttl = void 0 === options.ttl ? DEFAULT_TTL : options.ttl;
        this.maxEntries = void 0 === options.maxEntries ? DEFAULT_MAX_ENTRIES : options.maxEntries;
    }
    touch = (key)=>{
        this.useTick += 1;
        this.lastUsed.set(key, this.useTick);
    };
    keyOf = (args)=>(0, external_encodeCacheKey_js_namespaceObject.encodeCacheKey)(args);
    pathOf = (args)=>`entries${PathSeparator_js_namespaceObject.PATH_SEPARATOR}${this.keyOf(args)}`;
    getEntry = (args)=>{
        const key = this.keyOf(args);
        const entry = this.data.entries[key] || (0, external_getInitialCacheEntry_js_namespaceObject.getInitialCacheEntry)();
        this.touch(key);
        return {
            ...entry,
            stale: this.isStale(entry)
        };
    };
    getFailure = (args)=>this.failures.get(this.keyOf(args));
    load = (args)=>{
        const key = this.keyOf(args);
        const entry = this.data.entries[key];
        this.touch(key);
        if (entry && entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Success && !this.isStale(entry)) return Promise.resolve();
        return this.fetch(key, args);
    };
    refresh = (args)=>{
        const key = this.keyOf(args);
        this.touch(key);
        return this.fetch(key, args);
    };
    abort = (args)=>{
        this.abortKey(this.keyOf(args));
    };
    abortAll = ()=>{
        Array.from(this.controllers.keys()).forEach((key)=>this.abortKey(key));
    };
    invalidate = (args)=>{
        const key = this.keyOf(args);
        if (!this.data.entries[key]) return;
        this.update((draft)=>{
            draft.entries[key].invalidated = true;
        });
    };
    invalidateAll = ()=>{
        const keys = Object.keys(this.data.entries);
        if (0 === keys.length) return;
        this.update((draft)=>{
            keys.forEach((key)=>{
                draft.entries[key].invalidated = true;
            });
        });
    };
    forget = (args)=>{
        this.forgetKey(this.keyOf(args));
    };
    forgetAll = ()=>{
        Object.keys(this.data.entries).forEach((key)=>this.forgetKey(key));
    };
    forgetKey = (key)=>{
        this.abortKey(key);
        this.failures.delete(key);
        this.lastUsed.delete(key);
        if (!this.data.entries[key]) return;
        this.update((draft)=>{
            delete draft.entries[key];
        });
    };
    isStale = (entry)=>{
        if (entry.invalidated || void 0 === entry.updatedAt) return true;
        return Date.now() - entry.updatedAt > this.ttl;
    };
    isRetained = (key)=>{
        const prefix = `entries.${key}`;
        return Object.keys(this.subscribers).some((id)=>{
            const reads = this.subscribers[id].reads;
            return Array.from(reads).some((read)=>read === prefix || read.startsWith(`${prefix}${PathSeparator_js_namespaceObject.PATH_SEPARATOR}`));
        });
    };
    evict = ()=>{
        const keys = Object.keys(this.data.entries);
        if (keys.length <= this.maxEntries) return;
        const candidates = keys.filter((key)=>!this.requests.has(key) && !this.isRetained(key)).sort((left, right)=>(this.lastUsed.get(left) || 0) - (this.lastUsed.get(right) || 0));
        const excess = keys.length - this.maxEntries;
        const doomed = candidates.slice(0, excess);
        if (0 === doomed.length) return;
        doomed.forEach((key)=>{
            this.failures.delete(key);
            this.lastUsed.delete(key);
        });
        this.update((draft)=>{
            doomed.forEach((key)=>{
                delete draft.entries[key];
            });
        });
    };
    abortKey = (key)=>{
        const controller = this.controllers.get(key);
        if (!controller) return;
        controller.abort();
        this.controllers.delete(key);
        this.requests.delete(key);
        const entry = this.data.entries[key];
        if (entry && entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Pending) return void this.update((draft)=>{
            draft.entries[key].status = EResourceStatus_js_namespaceObject.EResourceStatus.Idle;
        });
        if (entry && entry.refreshing) this.update((draft)=>{
            draft.entries[key].refreshing = false;
        });
    };
    suspend = (args)=>{
        const key = this.keyOf(args);
        const entry = this.data.entries[key];
        this.touch(key);
        if (entry && entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Success && void 0 !== entry.data) return entry.data;
        if (entry && entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Error) throw this.failures.get(key) || new Error(entry.error || 'Carburetor: resource failed');
        const known = this.requests.get(key);
        throw known || this.fetch(key, args, true);
    };
    fetch = (key, args, deferNotification = false)=>{
        const known = this.requests.get(key);
        if (known) return known;
        const controller = new AbortController();
        this.controllers.set(key, controller);
        this.markLoading(key, deferNotification);
        const request = this.loader(args, controller.signal).then((data)=>{
            this.settleSuccess(key, controller, data);
        }, (error)=>{
            this.settleFailure(key, controller, error);
        });
        this.requests.set(key, request);
        this.evict();
        return request;
    };
    markLoading = (key, deferNotification)=>{
        const entry = this.data.entries[key];
        const draft = this.draft;
        if (entry) if (void 0 === entry.data) {
            draft.entries[key].status = EResourceStatus_js_namespaceObject.EResourceStatus.Pending;
            draft.entries[key].error = void 0;
        } else draft.entries[key].refreshing = true;
        else draft.entries[key] = {
            ...(0, external_getInitialCacheEntry_js_namespaceObject.getInitialCacheEntry)(),
            status: EResourceStatus_js_namespaceObject.EResourceStatus.Pending
        };
        if (deferNotification) return void this.emitSoon();
        this.emitUpdate();
    };
    isCurrent = (key, controller)=>this.controllers.get(key) === controller && !controller.signal.aborted;
    settleSuccess = (key, controller, data)=>{
        if (!this.isCurrent(key, controller) || !this.data.entries[key]) return;
        this.controllers.delete(key);
        this.requests.delete(key);
        this.failures.delete(key);
        this.update((draft)=>{
            draft.entries[key].status = EResourceStatus_js_namespaceObject.EResourceStatus.Success;
            draft.entries[key].data = data;
            draft.entries[key].error = void 0;
            draft.entries[key].updatedAt = Date.now();
            draft.entries[key].refreshing = false;
            draft.entries[key].invalidated = false;
        });
    };
    settleFailure = (key, controller, error)=>{
        if (!this.isCurrent(key, controller) || !this.data.entries[key]) return;
        this.controllers.delete(key);
        this.requests.delete(key);
        this.failures.set(key, error);
        const hasData = this.data.entries[key] && void 0 !== this.data.entries[key].data;
        this.update((draft)=>{
            draft.entries[key].error = (0, external_describeError_js_namespaceObject.describeError)(error);
            draft.entries[key].refreshing = false;
            if (!hasData) draft.entries[key].status = EResourceStatus_js_namespaceObject.EResourceStatus.Error;
        });
    };
}
exports.ResourceCache = __webpack_exports__.ResourceCache;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "ResourceCache"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
