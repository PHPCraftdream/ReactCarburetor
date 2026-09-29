import { PATCH_OPAQUE } from "../Models/Paths.mjs";
import { sameSelection } from "../Component/Connection/sameSelection.mjs";
import { deepClone } from "./Utils/deepClone.mjs";
import { applyDiff } from "./Paths/Diff/applyDiff.mjs";
import { diffPaths } from "./Paths/Diff/diffPaths.mjs";
import { sameKind } from "./Paths/Diff/sameKind.mjs";
import { detachOpaque } from "./Utils/detachOpaque.mjs";
import { SubscriberIndex } from "./Paths/SubscriberIndex.mjs";
import { WriteLog } from "./Paths/WriteLog.mjs";
import { WILDCARD_PATH } from "./Paths/WildcardPath.mjs";
import { syncUpdateScheduler } from "./Scheduling/SyncUpdateSchedulerInstance.mjs";
import { updateWave } from "./Scheduling/UpdateWaveInstance.mjs";
import { createReadProxy } from "./Tracking/createReadProxy.mjs";
import { createWriteProxy } from "./Tracking/createWriteProxy.mjs";
import { createAliasLedger } from "./Tracking/AliasLedger.mjs";
import { isTrackable } from "./Tracking/isTrackable.mjs";
import { updateBatch } from "./Transaction/UpdateBatchInstance.mjs";
import { getUid } from "./Utils/getUid.mjs";
import { diagnostics } from "./Diagnostics/DiagnosticsInstance.mjs";
import { READS_TRANSFER } from "./Paths/Markers/ReadsTransferBrand.mjs";
import { transferReads } from "./Paths/Markers/transferReads.mjs";
const detachWatchSelection = (value)=>{
    if (null === value || 'object' != typeof value) return value;
    return detachOpaque(value, (instance)=>{
        var _Object_getPrototypeOf_constructor, _Object_getPrototypeOf;
        throw new Error('watch() cannot select a live ' + ((null == (_Object_getPrototypeOf = Object.getPrototypeOf(instance)) ? void 0 : null == (_Object_getPrototypeOf_constructor = _Object_getPrototypeOf.constructor) ? void 0 : _Object_getPrototypeOf_constructor.name) || 'class') + " instance because in-place changes cannot produce a safe comparison. Select the fields the callback needs, or return a plain object of those fields.");
    });
};
class Carburetor {
    data;
    scheduler;
    subscribers = Object.create(null);
    subscriberIndex = new SubscriberIndex();
    aliases = createAliasLedger();
    patchPort = {};
    uid = getUid();
    version = 0;
    writes = new Set();
    writeLog = new WriteLog();
    draftTouched = false;
    pendingEmit = false;
    draftProxy = void 0;
    writeRecorder = (path)=>this.recordWrite(path);
    constructor(data, scheduler = syncUpdateScheduler){
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
        if (!isTrackable(data)) {
            record(WILDCARD_PATH);
            return this.data;
        }
        return createReadProxy(data, record, '', this.aliases);
    }
    setData(data) {
        var _this_aliases;
        const previous = this.data;
        null == (_this_aliases = this.aliases) || _this_aliases.checkState(data, '', previous);
        this.data = data;
        this.draftProxy = void 0;
        this.touchDraft();
        const changed = diffPaths(previous, data);
        if (changed.size > 0) {
            var _this_patchPort_listener, _this_patchPort;
            null == (_this_patchPort_listener = (_this_patchPort = this.patchPort).listener) || _this_patchPort_listener.call(_this_patchPort, PATCH_OPAQUE);
            changed.forEach((path)=>this.recordWrite(path));
        }
        this.emitUpdate();
        return data;
    }
    snapshot() {
        return deepClone(this.data);
    }
    restore(data) {
        var _this_aliases;
        const current = this.data;
        null == (_this_aliases = this.aliases) || _this_aliases.checkState(data, '');
        if (!isTrackable(current) || !isTrackable(data) || !sameKind(current, data)) return void this.setData(deepClone(data));
        const applied = applyDiff(this.draft, current, data);
        if (!applied) return void this.setData(deepClone(data));
        this.emitUpdate();
    }
    toJSON() {
        return this.snapshot();
    }
    fromJSON(value) {
        this.setData(value);
    }
    subscribe(callback, options = {}) {
        const id = options.id || getUid();
        const given = options.reads;
        let reads;
        reads = void 0 === given ? new Set([
            WILDCARD_PATH
        ]) : options[READS_TRANSFER] === given ? given : new Set(given);
        this.subscribers[id] = {
            callback
        };
        this.subscriberIndex.add(id, reads);
        return id;
    }
    extend(id, path) {
        if (!Object.prototype.hasOwnProperty.call(this.subscribers, id)) return;
        this.subscriberIndex.addPath(id, path);
    }
    unsubscribe(id) {
        if (Object.prototype.hasOwnProperty.call(this.subscribers, id)) {
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
        const id = getUid();
        const initial = this.runSelector(select);
        let previous = detachWatchSelection(initial.value);
        const callback = ()=>{
            const fresh = this.runSelector(select);
            const changed = !sameSelection(previous, fresh.value);
            this.subscribe(callback, transferReads(fresh.reads, id));
            if (changed) {
                const next = detachWatchSelection(fresh.value);
                const last = previous;
                previous = next;
                onChange(next, last);
            }
        };
        this.subscribe(callback, transferReads(initial.reads, id));
        return ()=>{
            this.unsubscribe(id);
        };
    }
    notifyWrites(writes) {
        updateWave.begin();
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
                if ("u" > typeof process && 'production' !== process.env.NODE_ENV) diagnostics.report('a subscriber threw while a write was delivered: ' + (error instanceof Error ? error.message : String(error)) + '. The write had already landed, so the remaining subscribers were notified anyway.');
            });
        } finally{
            updateWave.end();
        }
    }
    get draft() {
        const data = this.data;
        this.touchDraft();
        if (!isTrackable(data)) {
            var _this_patchPort_listener, _this_patchPort;
            null == (_this_patchPort_listener = (_this_patchPort = this.patchPort).listener) || _this_patchPort_listener.call(_this_patchPort, PATCH_OPAQUE);
            this.recordWrite(WILDCARD_PATH);
            return this.data;
        }
        if (!this.draftProxy) this.draftProxy = createWriteProxy(data, this.writeRecorder, '', this.aliases, void 0, this.patchPort);
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
            if (result instanceof Promise) diagnostics.report("update(mutate) published before the mutation finished: the callback returned a promise, so writes made after its first await wake nobody. Keep the callback synchronous and publish after the await instead.");
        }
    }
    emitSoon() {
        this.pendingEmit = true;
        const scheduledAt = this.version;
        queueMicrotask(()=>{
            this.pendingEmit = false;
            if (this.version === scheduledAt || this.draftTouched || this.writes.size > 0) this.emitUpdate();
        });
    }
    touchDraft() {
        if (this.draftTouched) return;
        this.draftTouched = true;
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV) queueMicrotask(()=>{
            if (!this.draftTouched || this.pendingEmit) return;
            diagnostics.report("a write went through draft, but emitUpdate() was never called, so no subscriber was notified. Prefer this.update(draft => ...), which does both.");
        });
    }
    recordWrite(path) {
        this.writes.add(path);
    }
    markAllChanged() {
        var _this_patchPort_listener, _this_patchPort;
        null == (_this_patchPort_listener = (_this_patchPort = this.patchPort).listener) || _this_patchPort_listener.call(_this_patchPort, PATCH_OPAQUE);
        this.recordWrite(WILDCARD_PATH);
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
            null == (_this_patchPort_listener = (_this_patchPort = this.patchPort).listener) || _this_patchPort_listener.call(_this_patchPort, PATCH_OPAQUE);
        }
        const writes = changed || new Set([
            WILDCARD_PATH
        ]);
        this.version++;
        this.writeLog.record(this.version, writes);
        if (updateBatch.isActive()) return void updateBatch.add(this, writes);
        this.notifyWrites(writes);
    }
}
export { Carburetor };
