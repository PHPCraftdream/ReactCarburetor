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
    Carburetor: ()=>Carburetor
});
const deepClone_js_namespaceObject = require("./Utils/deepClone.js");
const SubscriberIndex_js_namespaceObject = require("./Paths/SubscriberIndex.js");
const WildcardPath_js_namespaceObject = require("./Paths/WildcardPath.js");
const SyncUpdateSchedulerInstance_js_namespaceObject = require("./Scheduling/SyncUpdateSchedulerInstance.js");
const createReadProxy_js_namespaceObject = require("./Tracking/createReadProxy.js");
const createWriteProxy_js_namespaceObject = require("./Tracking/createWriteProxy.js");
const isTrackable_js_namespaceObject = require("./Tracking/isTrackable.js");
const UpdateBatchInstance_js_namespaceObject = require("./Transaction/UpdateBatchInstance.js");
const getUid_js_namespaceObject = require("./Utils/getUid.js");
const DiagnosticsInstance_js_namespaceObject = require("./Diagnostics/DiagnosticsInstance.js");
class Carburetor {
    data;
    scheduler;
    subscribers = {};
    subscriberIndex = new SubscriberIndex_js_namespaceObject.SubscriberIndex();
    uid = (0, getUid_js_namespaceObject.getUid)();
    version = 0;
    writes = new Set();
    draftTouched = false;
    pendingEmit = false;
    draftProxy = void 0;
    constructor(data, scheduler = SyncUpdateSchedulerInstance_js_namespaceObject.syncUpdateScheduler){
        this.data = data;
        this.scheduler = scheduler;
    }
    getUID = ()=>this.uid;
    getVersion = ()=>this.version;
    getData = ()=>this.data;
    read = (record)=>{
        const data = this.data;
        if (!(0, isTrackable_js_namespaceObject.isTrackable)(data)) {
            record(WildcardPath_js_namespaceObject.WILDCARD_PATH);
            return this.data;
        }
        return (0, createReadProxy_js_namespaceObject.createReadProxy)(data, record);
    };
    setData = (data)=>{
        this.data = data;
        this.draftProxy = void 0;
        this.writes.add(WildcardPath_js_namespaceObject.WILDCARD_PATH);
        this.emitUpdate();
        return data;
    };
    snapshot = ()=>(0, deepClone_js_namespaceObject.deepClone)(this.data);
    restore = (data)=>{
        this.setData((0, deepClone_js_namespaceObject.deepClone)(data));
    };
    toJSON = ()=>this.snapshot();
    fromJSON = (value)=>{
        this.restore(value);
    };
    subscribe = (callback, options = {})=>{
        const id = options.id || (0, getUid_js_namespaceObject.getUid)();
        const reads = options.reads ? new Set(options.reads) : new Set([
            WildcardPath_js_namespaceObject.WILDCARD_PATH
        ]);
        this.subscribers[id] = {
            callback,
            reads
        };
        this.subscriberIndex.add(id, reads);
        return id;
    };
    unsubscribe = (id)=>{
        if (id in this.subscribers) {
            this.scheduler.cancel(id);
            this.subscriberIndex.remove(id);
            delete this.subscribers[id];
        }
    };
    watch = (reads, callback)=>{
        const id = this.subscribe(callback, {
            reads
        });
        return ()=>{
            this.unsubscribe(id);
        };
    };
    notifyWrites = (writes)=>{
        this.subscriberIndex.match(writes).forEach((id)=>{
            const record = this.subscribers[id];
            if (record) this.scheduler.schedule(id, record.callback);
        });
    };
    get draft() {
        const data = this.data;
        this.touchDraft();
        if (!(0, isTrackable_js_namespaceObject.isTrackable)(data)) return this.data;
        if (!this.draftProxy) this.draftProxy = (0, createWriteProxy_js_namespaceObject.createWriteProxy)(data, this.recordWrite);
        return this.draftProxy;
    }
    update = (mutate)=>{
        mutate(this.draft);
        this.emitUpdate();
    };
    emitSoon = ()=>{
        this.pendingEmit = true;
        queueMicrotask(()=>{
            this.pendingEmit = false;
            this.emitUpdate();
        });
    };
    touchDraft = ()=>{
        if (this.draftTouched) return;
        this.draftTouched = true;
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV) queueMicrotask(()=>{
            if (!this.draftTouched || this.pendingEmit) return;
            DiagnosticsInstance_js_namespaceObject.diagnostics.report("a write went through draft, but emitUpdate() was never called, so no subscriber was notified. Prefer this.update(draft => ...), which does both.");
        });
    };
    recordWrite = (path)=>{
        this.writes.add(path);
    };
    preEmit = ()=>{};
    emitUpdate = ()=>{
        this.preEmit();
        const changed = this.writes.size > 0 ? new Set(this.writes) : void 0;
        const touched = this.draftTouched;
        this.writes.clear();
        this.draftTouched = false;
        if (!changed && touched) return;
        const writes = changed || new Set([
            WildcardPath_js_namespaceObject.WILDCARD_PATH
        ]);
        this.version++;
        if (UpdateBatchInstance_js_namespaceObject.updateBatch.isActive()) return void UpdateBatchInstance_js_namespaceObject.updateBatch.add(this, writes);
        this.notifyWrites(writes);
    };
}
exports.Carburetor = __webpack_exports__.Carburetor;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "Carburetor"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
