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
const joinPath_js_namespaceObject = require("../../Store/Paths/joinPath.js");
const deepClone_js_namespaceObject = require("../../Store/Utils/deepClone.js");
const external_describeError_js_namespaceObject = require("../describeError.js");
const external_createAbortHandle_js_namespaceObject = require("../createAbortHandle.js");
const external_getInitialCacheEntry_js_namespaceObject = require("./getInitialCacheEntry.js");
const external_EvictionLedger_js_namespaceObject = require("./EvictionLedger.js");
const DEFAULT_TTL = 30000;
const DEFAULT_MAX_ENTRIES = 100;
class ResourceCacheLifecycle extends Carburetor_js_namespaceObject.Carburetor {
    loader;
    bulkDepth = 0;
    restoreGeneration = 0;
    ttl;
    maxEntries;
    requests = new Map();
    controllers = new Map();
    failures = new Map();
    failedRetries;
    invalidatedRequests;
    viewCache = new Map();
    eviction = new external_EvictionLedger_js_namespaceObject.EvictionLedger();
    constructor(loader, options = {}){
        super({
            entries: {}
        }, options.scheduler), this.loader = loader;
        this.ttl = void 0 === options.ttl ? DEFAULT_TTL : options.ttl;
        this.maxEntries = void 0 === options.maxEntries ? DEFAULT_MAX_ENTRIES : options.maxEntries;
    }
    restore(data) {
        var _this_patchObservers;
        const generation = ++this.restoreGeneration;
        const controllers = Array.from(this.controllers.entries());
        this.controllers.clear();
        this.requests.clear();
        this.failures.clear();
        this.viewCache.clear();
        this.eviction.reset();
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
            if (!this.eviction.lastUsed.has(key)) this.touch(key);
        });
        this.controllers.forEach((_controller, key)=>{
            const entry = this.data.entries[key];
            if (entry) entries[key] = entry;
        });
        null == (_this_patchObservers = this.patchObservers) || _this_patchObservers.ownRestore(data);
        this.setData((0, deepClone_js_namespaceObject.deepClone)({
            entries
        }));
    }
    touch(key) {
        this.eviction.touch(key);
    }
    subscribe(callback, options = {}) {
        if (void 0 !== options.id && Object.prototype.hasOwnProperty.call(this.subscribers, options.id)) this.eviction.release();
        return super.subscribe(callback, options);
    }
    unsubscribe(id) {
        if (Object.prototype.hasOwnProperty.call(this.subscribers, id)) this.eviction.release();
        super.unsubscribe(id);
    }
    load(args) {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];
        this.touch(key);
        if (entry && entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Success && !this.isStale(entry)) return Promise.resolve();
        return this.fetch(key, args);
    }
    refresh(args) {
        const key = this.keyOf(args);
        this.touch(key);
        return this.fetch(key, args);
    }
    abort(args) {
        this.abortKey(this.keyOf(args));
    }
    abortAll() {
        this.bulkDepth++;
        try {
            Array.from(this.controllers.entries()).forEach(([key, controller])=>{
                if (this.controllers.get(key) === controller) this.abortKey(key);
            });
        } finally{
            this.finishBulk();
        }
    }
    invalidate(args) {
        const key = this.keyOf(args);
        if (!this.data.entries[key]) return;
        const controller = this.controllers.get(key);
        if (controller) (this.invalidatedRequests || (this.invalidatedRequests = new WeakSet())).add(controller);
        this.update((draft)=>{
            draft.entries[key].invalidated = true;
            draft.entries[key].failed = false;
        });
    }
    invalidateAll() {
        const keys = Object.keys(this.data.entries);
        if (0 === keys.length) return;
        this.update((draft)=>{
            keys.forEach((key)=>{
                const controller = this.controllers.get(key);
                if (controller) (this.invalidatedRequests || (this.invalidatedRequests = new WeakSet())).add(controller);
                draft.entries[key].invalidated = true;
                draft.entries[key].failed = false;
            });
        });
    }
    forget(args) {
        this.forgetKey(this.keyOf(args));
    }
    forgetAll() {
        this.bulkDepth++;
        try {
            Object.keys(this.data.entries).forEach((key)=>this.forgetKey(key));
        } finally{
            this.finishBulk();
        }
    }
    finishBulk() {
        this.bulkDepth--;
        if (0 === this.bulkDepth && (this.draftTouched || this.writes.size > 0)) super.emitUpdate();
    }
    emitUpdate() {
        if (0 === this.bulkDepth) super.emitUpdate();
    }
    forgetKey(key) {
        this.abortKey(key);
        if (this.controllers.has(key)) return;
        this.failures.delete(key);
        this.eviction.lastUsed.delete(key);
        this.viewCache.delete(key);
        if (!this.data.entries[key]) return;
        this.eviction.forget(key);
        this.update((draft)=>{
            delete draft.entries[key];
        });
    }
    isStale(entry) {
        if (entry.invalidated || void 0 === entry.updatedAt) return true;
        return Date.now() - entry.updatedAt > this.ttl;
    }
    evict(deferNotification = false) {
        if (this.eviction.shouldSkip(this.maxEntries)) return;
        const doomed = this.eviction.selectVictims(this.maxEntries, (key)=>this.requests.has(key) || this.subscriberIndex.hasReaderAt((0, joinPath_js_namespaceObject.joinPath)('entries', key)));
        if (0 === doomed.length) return;
        doomed.forEach((key)=>{
            this.failures.delete(key);
            this.viewCache.delete(key);
        });
        const draft = this.draft;
        doomed.forEach((key)=>{
            delete draft.entries[key];
        });
        if (deferNotification) {
            if (!this.pendingEmit) this.emitSoon();
        } else this.emitUpdate();
    }
    isRetentionFree(key) {
        return !this.requests.has(key) && !this.subscriberIndex.hasReaderAt((0, joinPath_js_namespaceObject.joinPath)('entries', key));
    }
    abortKey(key) {
        const controller = this.controllers.get(key);
        if (!controller) return;
        this.controllers.delete(key);
        this.requests.delete(key);
        controller.abort();
        if (this.controllers.has(key)) return;
        const entry = this.data.entries[key];
        if (entry && entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Pending) return void this.update((draft)=>{
            var _draft_entries_key;
            var _this_failedRetries;
            draft.entries[key].status = EResourceStatus_js_namespaceObject.EResourceStatus.Idle;
            (_draft_entries_key = draft.entries[key]).failed || (_draft_entries_key.failed = (null == (_this_failedRetries = this.failedRetries) ? void 0 : _this_failedRetries.has(controller)) || this.failures.has(key));
        });
        if (entry && entry.refreshing) this.update((draft)=>{
            var _draft_entries_key;
            var _this_failedRetries;
            draft.entries[key].refreshing = false;
            (_draft_entries_key = draft.entries[key]).failed || (_draft_entries_key.failed = (null == (_this_failedRetries = this.failedRetries) ? void 0 : _this_failedRetries.has(controller)) || this.failures.has(key));
        });
    }
    suspend(args) {
        const key = this.keyOf(args);
        const entry = this.data.entries[key];
        this.touch(key);
        if (entry && entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Success) {
            if (this.isStale(entry) && !entry.failed && !this.requests.has(key)) this.fetch(key, args, true);
            return entry.data;
        }
        if (entry && entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Error) {
            if (entry.invalidated && !entry.failed) throw this.fetch(key, args, true);
            const failure = this.failures.get(key);
            if (failure && failure.entry !== entry) this.failures.delete(key);
            throw (null == failure ? void 0 : failure.entry) === entry ? failure.value : new Error(entry.error || 'Carburetor: resource failed');
        }
        const known = this.requests.get(key);
        throw known || this.fetch(key, args, true);
    }
    fetch(key, args, deferNotification = false) {
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
        const entry = this.data.entries[key];
        if (entry && (entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Error || entry.failed || void 0 !== entry.error)) (this.failedRetries || (this.failedRetries = new WeakSet())).add(controller);
        this.markLoading(key, deferNotification, entry);
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
    }
    markLoading(key, deferNotification, entry) {
        const draft = this.draft;
        if (entry) if (entry.status !== EResourceStatus_js_namespaceObject.EResourceStatus.Success) {
            draft.entries[key].status = EResourceStatus_js_namespaceObject.EResourceStatus.Pending;
            draft.entries[key].error = void 0;
        } else draft.entries[key].refreshing = true;
        else {
            draft.entries[key] = {
                ...(0, external_getInitialCacheEntry_js_namespaceObject.getInitialCacheEntry)(),
                status: EResourceStatus_js_namespaceObject.EResourceStatus.Pending
            };
            this.eviction.create();
        }
        if (deferNotification) return void this.emitSoon();
        this.emitUpdate();
    }
    isCurrent(key, controller) {
        return this.controllers.get(key) === controller && !controller.signal.aborted;
    }
    settleSuccess(key, controller, data) {
        if (!this.isCurrent(key, controller)) return;
        if (!this.data.entries[key]) {
            this.controllers.delete(key);
            this.requests.delete(key);
            this.failures.delete(key);
            this.eviction.lastUsed.delete(key);
            this.viewCache.delete(key);
            return;
        }
        this.controllers.delete(key);
        this.requests.delete(key);
        this.failures.delete(key);
        if (this.isRetentionFree(key)) this.eviction.release();
        this.update((draft)=>{
            var _this_invalidatedRequests;
            draft.entries[key].status = EResourceStatus_js_namespaceObject.EResourceStatus.Success;
            draft.entries[key].data = data;
            draft.entries[key].error = void 0;
            draft.entries[key].updatedAt = Date.now();
            draft.entries[key].refreshing = false;
            draft.entries[key].invalidated = (null == (_this_invalidatedRequests = this.invalidatedRequests) ? void 0 : _this_invalidatedRequests.has(controller)) || false;
            draft.entries[key].failed = false;
        });
        this.evict();
    }
    settleFailure(key, controller, error) {
        if (!this.isCurrent(key, controller)) return;
        if (!this.data.entries[key]) {
            this.controllers.delete(key);
            this.requests.delete(key);
            this.failures.delete(key);
            this.eviction.lastUsed.delete(key);
            this.viewCache.delete(key);
            return;
        }
        this.controllers.delete(key);
        this.requests.delete(key);
        if (this.isRetentionFree(key)) this.eviction.release();
        const entry = this.data.entries[key];
        const hasData = entry.status === EResourceStatus_js_namespaceObject.EResourceStatus.Success || void 0 !== entry.data;
        const message = (0, external_describeError_js_namespaceObject.describeError)(error);
        this.failures.set(key, {
            value: error,
            error: message,
            status: hasData ? entry.status : EResourceStatus_js_namespaceObject.EResourceStatus.Error,
            entry
        });
        this.update((draft)=>{
            var _this_invalidatedRequests;
            draft.entries[key].error = message;
            draft.entries[key].refreshing = false;
            draft.entries[key].failed = !(null == (_this_invalidatedRequests = this.invalidatedRequests) ? void 0 : _this_invalidatedRequests.has(controller));
            if (!hasData) draft.entries[key].status = EResourceStatus_js_namespaceObject.EResourceStatus.Error;
        });
        this.evict();
    }
}
exports.ResourceCacheLifecycle = __webpack_exports__.ResourceCacheLifecycle;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "ResourceCacheLifecycle"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
