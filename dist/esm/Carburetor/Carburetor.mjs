import { WILDCARD_PATH, pathsIntersect } from "./Paths.mjs";
import { deepClone } from "./Snapshot.mjs";
import { syncUpdateScheduler } from "./SyncUpdateScheduler.mjs";
import { updateBatch } from "./Transaction.mjs";
import { createReadProxy, createWriteProxy, isTrackable } from "./Tracking.mjs";
import { getUid } from "./Utils/getUid.mjs";
class Carburetor {
    data;
    scheduler;
    subscribers = {};
    uid = getUid();
    version = 0;
    writes = new Set();
    draftTouched = false;
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
    subscribe = (callback, customId, reads)=>{
        const id = customId || getUid();
        this.subscribers[id] = {
            callback,
            reads: reads || new Set([
                WILDCARD_PATH
            ])
        };
        return id;
    };
    unsubscribe = (id)=>{
        if (id in this.subscribers) {
            this.scheduler.cancel(id);
            delete this.subscribers[id];
        }
    };
    watch = (reads, callback)=>{
        const id = this.subscribe(callback, void 0, new Set(reads));
        return ()=>{
            this.unsubscribe(id);
        };
    };
    notifyWrites = (writes)=>{
        Object.keys(this.subscribers).forEach((id)=>{
            const record = this.subscribers[id];
            if (record && pathsIntersect(record.reads, writes)) this.scheduler.schedule(id, record.callback);
        });
    };
    get draft() {
        const data = this.data;
        this.draftTouched = true;
        if (!isTrackable(data)) return this.data;
        if (!this.draftProxy) this.draftProxy = createWriteProxy(data, this.recordWrite);
        return this.draftProxy;
    }
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
