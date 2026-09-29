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
const Paths_js_namespaceObject = require("../Models/Paths.js");
const sameSelection_js_namespaceObject = require("../Component/Connection/sameSelection.js");
const deepClone_js_namespaceObject = require("./Utils/deepClone.js");
const applyDiff_js_namespaceObject = require("./Paths/Diff/applyDiff.js");
const diffPaths_js_namespaceObject = require("./Paths/Diff/diffPaths.js");
const sameKind_js_namespaceObject = require("./Paths/Diff/sameKind.js");
const detachOpaque_js_namespaceObject = require("./Utils/detachOpaque.js");
const SubscriberIndex_js_namespaceObject = require("./Paths/SubscriberIndex.js");
const WriteLog_js_namespaceObject = require("./Paths/WriteLog.js");
const WildcardPath_js_namespaceObject = require("./Paths/WildcardPath.js");
const SyncUpdateSchedulerInstance_js_namespaceObject = require("./Scheduling/SyncUpdateSchedulerInstance.js");
const UpdateWaveInstance_js_namespaceObject = require("./Scheduling/UpdateWaveInstance.js");
const createReadProxy_js_namespaceObject = require("./Tracking/createReadProxy.js");
const createWriteProxy_js_namespaceObject = require("./Tracking/createWriteProxy.js");
const AliasLedger_js_namespaceObject = require("./Tracking/AliasLedger.js");
const isTrackable_js_namespaceObject = require("./Tracking/isTrackable.js");
const UpdateBatchInstance_js_namespaceObject = require("./Transaction/UpdateBatchInstance.js");
const getUid_js_namespaceObject = require("./Utils/getUid.js");
const DiagnosticsInstance_js_namespaceObject = require("./Diagnostics/DiagnosticsInstance.js");
const ReadsTransferBrand_js_namespaceObject = require("./Paths/Markers/ReadsTransferBrand.js");
const transferReads_js_namespaceObject = require("./Paths/Markers/transferReads.js");
const detachWatchSelection = (value)=>{
    if (null === value || 'object' != typeof value) return value;
    return (0, detachOpaque_js_namespaceObject.detachOpaque)(value, (instance)=>{
        var _Object_getPrototypeOf_constructor, _Object_getPrototypeOf;
        throw new Error('watch() cannot select a live ' + ((null == (_Object_getPrototypeOf = Object.getPrototypeOf(instance)) ? void 0 : null == (_Object_getPrototypeOf_constructor = _Object_getPrototypeOf.constructor) ? void 0 : _Object_getPrototypeOf_constructor.name) || 'class') + " instance because in-place changes cannot produce a safe comparison. Select the fields the callback needs, or return a plain object of those fields.");
    });
};
class Carburetor {
    data;
    scheduler;
    subscribers = {};
    subscriberIndex = new SubscriberIndex_js_namespaceObject.SubscriberIndex();
    aliases = (0, AliasLedger_js_namespaceObject.createAliasLedger)();
    patchPort = {};
    uid = (0, getUid_js_namespaceObject.getUid)();
    version = 0;
    writes = new Set();
    writeLog = new WriteLog_js_namespaceObject.WriteLog();
    draftTouched = false;
    pendingEmit = false;
    draftProxy = void 0;
    writeRecorder = (path)=>this.recordWrite(path);
    constructor(data, scheduler = SyncUpdateSchedulerInstance_js_namespaceObject.syncUpdateScheduler){
        var _this_aliases;
        this.data = data;
        this.scheduler = scheduler;
        null == (_this_aliases = this.aliases) || _this_aliases.checkState(data, '');
    }
    getUID() {
        return this.uid;
    }
    getVersion() {
        return this.version;
    }
    hasDriftSince(baselineVersion, reads) {
        return this.writeLog.matches(baselineVersion, reads);
    }
    getData() {
        return this.data;
    }
    read(record) {
        const data = this.data;
        if (!(0, isTrackable_js_namespaceObject.isTrackable)(data)) {
            record(WildcardPath_js_namespaceObject.WILDCARD_PATH);
            return this.data;
        }
        return (0, createReadProxy_js_namespaceObject.createReadProxy)(data, record, '', this.aliases);
    }
    setData(data) {
        var _this_aliases;
        const previous = this.data;
        null == (_this_aliases = this.aliases) || _this_aliases.checkState(data, '', previous);
        this.data = data;
        this.draftProxy = void 0;
        this.touchDraft();
        const changed = (0, diffPaths_js_namespaceObject.diffPaths)(previous, data);
        if (changed.size > 0) {
            var _this_patchPort_listener, _this_patchPort;
            null == (_this_patchPort_listener = (_this_patchPort = this.patchPort).listener) || _this_patchPort_listener.call(_this_patchPort, Paths_js_namespaceObject.PATCH_OPAQUE);
            changed.forEach((path)=>this.recordWrite(path));
        }
        this.emitUpdate();
        return data;
    }
    snapshot() {
        return (0, deepClone_js_namespaceObject.deepClone)(this.data);
    }
    restore(data) {
        var _this_aliases;
        const current = this.data;
        null == (_this_aliases = this.aliases) || _this_aliases.checkState(data, '');
        if (!(0, isTrackable_js_namespaceObject.isTrackable)(current) || !(0, isTrackable_js_namespaceObject.isTrackable)(data) || !(0, sameKind_js_namespaceObject.sameKind)(current, data)) return void this.setData((0, deepClone_js_namespaceObject.deepClone)(data));
        const applied = (0, applyDiff_js_namespaceObject.applyDiff)(this.draft, current, data);
        if (!applied) return void this.setData((0, deepClone_js_namespaceObject.deepClone)(data));
        this.emitUpdate();
    }
    toJSON() {
        return this.snapshot();
    }
    fromJSON(value) {
        this.setData(value);
    }
    subscribe(callback, options = {}) {
        const id = options.id || (0, getUid_js_namespaceObject.getUid)();
        const given = options.reads;
        let reads;
        reads = void 0 === given ? new Set([
            WildcardPath_js_namespaceObject.WILDCARD_PATH
        ]) : options[ReadsTransferBrand_js_namespaceObject.READS_TRANSFER] === given ? given : new Set(given);
        this.subscribers[id] = {
            callback
        };
        this.subscriberIndex.add(id, reads);
        return id;
    }
    extend(id, path) {
        if (!(id in this.subscribers)) return;
        this.subscriberIndex.addPath(id, path);
    }
    unsubscribe(id) {
        if (id in this.subscribers) {
            this.scheduler.cancel(id);
            this.subscriberIndex.remove(id);
            delete this.subscribers[id];
        }
    }
    attachPatchListener(listener) {
        this.patchPort.listener = listener;
        return ()=>{
            if (this.patchPort.listener === listener) this.patchPort.listener = void 0;
        };
    }
    runSelector(select) {
        const reads = new Set();
        const view = this.read((path)=>reads.add(path));
        return {
            value: select(view),
            reads
        };
    }
    watch(select, onChange) {
        const id = (0, getUid_js_namespaceObject.getUid)();
        const initial = this.runSelector(select);
        let previous = detachWatchSelection(initial.value);
        const callback = ()=>{
            const fresh = this.runSelector(select);
            const changed = !(0, sameSelection_js_namespaceObject.sameSelection)(previous, fresh.value);
            this.subscribe(callback, (0, transferReads_js_namespaceObject.transferReads)(fresh.reads, id));
            if (changed) {
                const next = detachWatchSelection(fresh.value);
                const last = previous;
                previous = next;
                onChange(next, last);
            }
        };
        this.subscribe(callback, (0, transferReads_js_namespaceObject.transferReads)(initial.reads, id));
        return ()=>{
            this.unsubscribe(id);
        };
    }
    notifyWrites(writes) {
        UpdateWaveInstance_js_namespaceObject.updateWave.begin();
        try {
            let failures;
            this.subscriberIndex.match(writes).forEach((id)=>{
                const record = this.subscribers[id];
                if (record) try {
                    this.scheduler.schedule(id, record.callback);
                } catch (error) {
                    (failures ?? (failures = [])).push(error);
                }
            });
            null == failures || failures.forEach((error)=>{
                if ("u" > typeof process && 'production' !== process.env.NODE_ENV) DiagnosticsInstance_js_namespaceObject.diagnostics.report('a subscriber threw while a write was delivered: ' + (error instanceof Error ? error.message : String(error)) + '. The write had already landed, so the remaining subscribers were notified anyway.');
            });
        } finally{
            UpdateWaveInstance_js_namespaceObject.updateWave.end();
        }
    }
    get draft() {
        const data = this.data;
        this.touchDraft();
        if (!(0, isTrackable_js_namespaceObject.isTrackable)(data)) {
            var _this_patchPort_listener, _this_patchPort;
            null == (_this_patchPort_listener = (_this_patchPort = this.patchPort).listener) || _this_patchPort_listener.call(_this_patchPort, Paths_js_namespaceObject.PATCH_OPAQUE);
            this.recordWrite(WildcardPath_js_namespaceObject.WILDCARD_PATH);
            return this.data;
        }
        if (!this.draftProxy) this.draftProxy = (0, createWriteProxy_js_namespaceObject.createWriteProxy)(data, this.writeRecorder, '', this.aliases, void 0, this.patchPort);
        return this.draftProxy;
    }
    update(mutate) {
        let result;
        try {
            result = mutate(this.draft);
        } finally{
            this.emitUpdate();
        }
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV) {
            if (result instanceof Promise) DiagnosticsInstance_js_namespaceObject.diagnostics.report("update(mutate) published before the mutation finished: the callback returned a promise, so writes made after its first await wake nobody. Keep the callback synchronous and publish after the await instead.");
        }
    }
    emitSoon() {
        this.pendingEmit = true;
        queueMicrotask(()=>{
            this.pendingEmit = false;
            this.emitUpdate();
        });
    }
    touchDraft() {
        if (this.draftTouched) return;
        this.draftTouched = true;
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV) queueMicrotask(()=>{
            if (!this.draftTouched || this.pendingEmit) return;
            DiagnosticsInstance_js_namespaceObject.diagnostics.report("a write went through draft, but emitUpdate() was never called, so no subscriber was notified. Prefer this.update(draft => ...), which does both.");
        });
    }
    recordWrite(path) {
        this.writes.add(path);
    }
    markAllChanged() {
        var _this_patchPort_listener, _this_patchPort;
        null == (_this_patchPort_listener = (_this_patchPort = this.patchPort).listener) || _this_patchPort_listener.call(_this_patchPort, Paths_js_namespaceObject.PATCH_OPAQUE);
        this.recordWrite(WildcardPath_js_namespaceObject.WILDCARD_PATH);
    }
    preEmit() {}
    emitUpdate() {
        this.preEmit();
        const touched = this.draftTouched;
        const changed = this.writes.size > 0 ? this.writes : void 0;
        if (changed) this.writes = new Set();
        this.draftTouched = false;
        if (!changed && touched) return;
        if (!changed) {
            var _this_patchPort_listener, _this_patchPort;
            null == (_this_patchPort_listener = (_this_patchPort = this.patchPort).listener) || _this_patchPort_listener.call(_this_patchPort, Paths_js_namespaceObject.PATCH_OPAQUE);
        }
        const writes = changed || new Set([
            WildcardPath_js_namespaceObject.WILDCARD_PATH
        ]);
        this.version++;
        this.writeLog.record(this.version, writes);
        if (UpdateBatchInstance_js_namespaceObject.updateBatch.isActive()) return void UpdateBatchInstance_js_namespaceObject.updateBatch.add(this, writes);
        this.notifyWrites(writes);
    }
}
exports.Carburetor = __webpack_exports__.Carburetor;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "Carburetor"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
