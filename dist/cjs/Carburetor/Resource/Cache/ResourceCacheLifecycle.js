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
    ResourceCacheLifecycle: ()=>ResourceCacheLifecycle
});
const EResourceStatus_js_namespaceObject = require("../../Models/Enums/EResourceStatus.js");
const Carburetor_js_namespaceObject = require("../../Store/Carburetor.js");
const PathSeparator_js_namespaceObject = require("../../Store/Paths/PathSeparator.js");
const joinPath_js_namespaceObject = require("../../Store/Paths/joinPath.js");
const deepClone_js_namespaceObject = require("../../Store/Utils/deepClone.js");
const external_describeError_js_namespaceObject = require("../describeError.js");
const external_createAbortHandle_js_namespaceObject = require("../createAbortHandle.js");
const external_getInitialCacheEntry_js_namespaceObject = require("./getInitialCacheEntry.js");
const DEFAULT_TTL = 30000;
const DEFAULT_MAX_ENTRIES = 100;
const ENTRIES_PREFIX = `entries${PathSeparator_js_namespaceObject.PATH_SEPARATOR}`;
class ResourceCacheLifecycle extends Carburetor_js_namespaceObject.Carburetor {
    loader;
    restoreGeneration = 0;
    ttl;
    maxEntries;
    requests = new Map();
    controllers = new Map();
    failures = new Map();
    lastUsed = new Map();
    useTick = 0;
    viewCache = new Map();
    constructor(loader, options = {}){
        super({
            entries: {}
        }, options.scheduler), this.loader = loader;
        this.ttl = void 0 === options.ttl ? DEFAULT_TTL : options.ttl;
        this.maxEntries = void 0 === options.maxEntries ? DEFAULT_MAX_ENTRIES : options.maxEntries;
    }
    restore = (data)=>{
        const generation = ++this.restoreGeneration;
        const controllers = Array.from(this.controllers.entries());
        this.controllers.clear();
        this.requests.clear();
        this.failures.clear();
        this.viewCache.clear();
        this.lastUsed.clear();
        controllers.forEach(([, controller])=>controller.abort());
        if (generation !== this.restoreGeneration) return;
        const entries = {};
        Object.keys(data.entries).forEach((key)=>{
            const entry = data.entries[key];
            entries[key] = {
                ...entry,
                refreshing: false,
                status: entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Pending ? EResourceStatus_js_namespaceObject.EResourceStatus.Idle : entry.status
            };
        });
        this.controllers.forEach((_controller, key)=>{
            const entry = this.data.entries[key];
            if (entry) entries[key] = entry;
        });
        this.setData((0, deepClone_js_namespaceObject.deepClone)({
            entries
        }));
    };
    touch = (key)=>{
        this.useTick += 1;
        this.lastUsed.set(key, this.useTick);
    };
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
            draft.entries[key].failed = false;
        });
    };
    invalidateAll = ()=>{
        const keys = Object.keys(this.data.entries);
        if (0 === keys.length) return;
        this.update((draft)=>{
            keys.forEach((key)=>{
                draft.entries[key].invalidated = true;
                draft.entries[key].failed = false;
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
        this.viewCache.delete(key);
        if (!this.data.entries[key]) return;
        this.update((draft)=>{
            delete draft.entries[key];
        });
    };
    isStale = (entry)=>{
        if (entry.invalidated || void 0 === entry.updatedAt) return true;
        return Date.now() - entry.updatedAt > this.ttl;
    };
    isViewCurrent = (view, entry, stale)=>view.stale === stale && view.status === entry.status && view.data === entry.data && view.error === entry.error && view.updatedAt === entry.updatedAt && view.refreshing === entry.refreshing && view.invalidated === entry.invalidated && view.failed === entry.failed;
    retainedKeys = ()=>{
        const retained = new Set();
        Object.keys(this.subscribers).forEach((id)=>{
            this.subscribers[id].reads.forEach((read)=>{
                if (!read.startsWith(ENTRIES_PREFIX)) return;
                const segment = read.slice(ENTRIES_PREFIX.length).split(PathSeparator_js_namespaceObject.PATH_SEPARATOR)[0];
                if (segment) retained.add(segment);
            });
        });
        return retained;
    };
    evict = (deferNotification = false)=>{
        const keys = Object.keys(this.data.entries);
        if (keys.length <= this.maxEntries) return;
        const retained = this.retainedKeys();
        const candidates = keys.filter((key)=>!this.requests.has(key) && !retained.has((0, joinPath_js_namespaceObject.joinPath)('', key))).sort((left, right)=>(this.lastUsed.get(left) || 0) - (this.lastUsed.get(right) || 0));
        const excess = keys.length - this.maxEntries;
        const doomed = candidates.slice(0, excess);
        if (0 === doomed.length) return;
        doomed.forEach((key)=>{
            this.failures.delete(key);
            this.lastUsed.delete(key);
            this.viewCache.delete(key);
        });
        const draft = this.draft;
        doomed.forEach((key)=>{
            delete draft.entries[key];
        });
        if (deferNotification) {
            if (!this.pendingEmit) this.emitSoon();
            return;
        }
        this.emitUpdate();
    };
    abortKey = (key)=>{
        const controller = this.controllers.get(key);
        if (!controller) return;
        if (this.controllers.get(key) === controller) {
            this.controllers.delete(key);
            this.requests.delete(key);
        }
        controller.abort();
        if (this.controllers.has(key)) return;
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
        if (entry && entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Success) return entry.data;
        if (entry && entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Error) throw this.failures.has(key) ? this.failures.get(key) : new Error(entry.error || 'Carburetor: resource failed');
        const known = this.requests.get(key);
        throw known || this.fetch(key, args, true);
    };
    fetch = (key, args, deferNotification = false)=>{
        const known = this.requests.get(key);
        if (known) return known;
        const controller = (0, external_createAbortHandle_js_namespaceObject.createAbortHandle)();
        let resolveRequest = ()=>void 0;
        let rejectRequest = ()=>void 0;
        const request = new Promise((resolve, reject)=>{
            resolveRequest = resolve;
            rejectRequest = reject;
        });
        this.controllers.set(key, controller);
        this.requests.set(key, request);
        this.markLoading(key, deferNotification);
        if (!this.isCurrent(key, controller)) {
            resolveRequest();
            return request;
        }
        let answer;
        try {
            answer = this.loader(args, controller.signal);
        } catch (error) {
            answer = Promise.reject(error);
        }
        answer.then((data)=>{
            this.settleSuccess(key, controller, data);
        }, (error)=>{
            this.settleFailure(key, controller, error);
        }).then(resolveRequest, rejectRequest);
        this.evict(deferNotification);
        return request;
    };
    markLoading = (key, deferNotification)=>{
        const entry = this.data.entries[key];
        const draft = this.draft;
        if (entry) if (entry.status !== EResourceStatus_js_namespaceObject.EResourceStatus.Success) {
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
            draft.entries[key].failed = false;
        });
        this.evict();
    };
    settleFailure = (key, controller, error)=>{
        if (!this.isCurrent(key, controller) || !this.data.entries[key]) return;
        this.controllers.delete(key);
        this.requests.delete(key);
        this.failures.set(key, error);
        const entry = this.data.entries[key];
        const hasData = entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Success || void 0 !== entry.data;
        this.update((draft)=>{
            draft.entries[key].error = (0, external_describeError_js_namespaceObject.describeError)(error);
            draft.entries[key].refreshing = false;
            draft.entries[key].failed = true;
            if (!hasData) draft.entries[key].status = EResourceStatus_js_namespaceObject.EResourceStatus.Error;
        });
        this.evict();
    };
}
exports.ResourceCacheLifecycle = __webpack_exports__.ResourceCacheLifecycle;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "ResourceCacheLifecycle"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
