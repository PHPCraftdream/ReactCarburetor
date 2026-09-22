import { deepClone } from "./Utils/deepClone.mjs";
import { SubscriberIndex } from "./Paths/SubscriberIndex.mjs";
import { WILDCARD_PATH } from "./Paths/WildcardPath.mjs";
import { syncUpdateScheduler } from "./Scheduling/SyncUpdateSchedulerInstance.mjs";
import { updateWave } from "./Scheduling/UpdateWaveInstance.mjs";
import { createReadProxy } from "./Tracking/createReadProxy.mjs";
import { createWriteProxy } from "./Tracking/createWriteProxy.mjs";
import { isTrackable } from "./Tracking/isTrackable.mjs";
import { updateBatch } from "./Transaction/UpdateBatchInstance.mjs";
import { getUid } from "./Utils/getUid.mjs";
import { diagnostics } from "./Diagnostics/DiagnosticsInstance.mjs";
class Carburetor {
    data;
    scheduler;
    subscribers = {};
    subscriberIndex = new SubscriberIndex();
    uid = getUid();
    version = 0;
    writes = new Set();
    draftTouched = false;
    pendingEmit = false;
    draftProxy = void 0;
    constructor(data, scheduler = syncUpdateScheduler){
        this.data = data;
        this.scheduler = scheduler;
    }
    getUID = ()=>this.uid;
    getVersion = ()=>this.version;
    getData = ()=>this.data;
    read = (record)=>{
        const data = this.data;
        if (!isTrackable(data)) {
            record(WILDCARD_PATH);
            return this.data;
        }
        return createReadProxy(data, record);
    };
    setData = (data)=>{
        this.data = data;
        this.draftProxy = void 0;
        this.writes.add(WILDCARD_PATH);
        this.emitUpdate();
        return data;
    };
    snapshot = ()=>deepClone(this.data);
    restore = (data)=>{
        this.setData(deepClone(data));
    };
    toJSON = ()=>this.snapshot();
    fromJSON = (value)=>{
        this.restore(value);
    };
    subscribe = (callback, options = {})=>{
        const id = options.id || getUid();
        const reads = options.reads ? new Set(options.reads) : new Set([
            WILDCARD_PATH
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
        updateWave.begin();
        try {
            this.subscriberIndex.match(writes).forEach((id)=>{
                const record = this.subscribers[id];
                if (record) this.scheduler.schedule(id, record.callback);
            });
        } finally{
            updateWave.end();
        }
    };
    get draft() {
        const data = this.data;
        this.touchDraft();
        if (!isTrackable(data)) {
            this.recordWrite(WILDCARD_PATH);
            return this.data;
        }
        if (!this.draftProxy) this.draftProxy = createWriteProxy(data, this.recordWrite);
        return this.draftProxy;
    }
    update = (mutate)=>{
        const result = mutate(this.draft);
        this.emitUpdate();
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV) {
            if (result instanceof Promise) diagnostics.report("update(mutate) published before the mutation finished: the callback returned a promise, so writes made after its first await wake nobody. Keep the callback synchronous and publish after the await instead.");
        }
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
            diagnostics.report("a write went through draft, but emitUpdate() was never called, so no subscriber was notified. Prefer this.update(draft => ...), which does both.");
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
            WILDCARD_PATH
        ]);
        this.version++;
        if (updateBatch.isActive()) return void updateBatch.add(this, writes);
        this.notifyWrites(writes);
    };
}
export { Carburetor };
