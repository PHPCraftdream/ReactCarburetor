import { getUid } from "../Store/Utils/getUid.mjs";
import { updateWave } from "../Store/Scheduling/UpdateWaveInstance.mjs";
import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
import { diagnostics } from "../Store/Diagnostics/DiagnosticsInstance.mjs";
const invalidationEdges = new WeakMap();
class Computed {
    body;
    uid = getUid();
    version = 0;
    subscribers = {};
    dependencies = {};
    versions = {};
    announced = void 0;
    value = void 0;
    valid = false;
    constructor(body){
        this.body = body;
        invalidationEdges.set(this.onDependencyChanged, this.markStale);
    }
    getUID = ()=>this.uid;
    getVersion = ()=>this.version;
    get = ()=>{
        if (this.isStale()) this.recompute();
        return this.value;
    };
    subscribe = (callback, options = {})=>{
        const id = options.id || getUid();
        const wasUnobserved = 0 === Object.keys(this.subscribers).length;
        this.subscribers[id] = callback;
        if (!this.valid || wasUnobserved && this.hasDrifted()) this.recompute();
        else if (wasUnobserved) this.observeDependencies();
        if (wasUnobserved && this.valid) this.announced = {
            value: this.value
        };
        return id;
    };
    unsubscribe = (id)=>{
        if (!(id in this.subscribers)) return;
        delete this.subscribers[id];
        if (0 === Object.keys(this.subscribers).length) {
            this.releaseDependencies();
            this.valid = false;
        }
    };
    isStale = ()=>{
        if (Object.keys(this.subscribers).length > 0) return !this.valid;
        return !this.valid || this.hasDrifted();
    };
    hasDrifted = ()=>Object.keys(this.versions).some((cuid)=>{
            const recorded = this.versions[cuid];
            return recorded.source.getVersion() !== recorded.version;
        });
    recompute = ()=>{
        const collected = {};
        const track = (source)=>{
            const cuid = source.getUID();
            const dependency = collected[cuid] || {
                source,
                reads: new Set()
            };
            collected[cuid] = dependency;
            if ('read' in source) return source.read((path)=>{
                dependency.reads.add(path);
            });
            dependency.reads.add(WILDCARD_PATH);
            return source.get();
        };
        this.value = this.body(track);
        this.valid = true;
        this.attachDependencies(collected);
    };
    attachDependencies = (collected)=>{
        const fresh = this.diffDependencies(collected);
        this.dependencies = collected;
        this.recordVersions(collected);
        if (0 === Object.keys(this.subscribers).length) return;
        Object.keys(collected).forEach((cuid)=>{
            if (!fresh[cuid]) return;
            const dependency = collected[cuid];
            dependency.source.subscribe(this.onDependencyChanged, {
                id: this.uid,
                reads: dependency.reads
            });
        });
    };
    diffDependencies = (collected)=>{
        const fresh = {};
        Object.keys(this.dependencies).forEach((cuid)=>{
            const next = collected[cuid];
            if (!next) return void this.dependencies[cuid].source.unsubscribe(this.uid);
            if (!this.sameReads(this.dependencies[cuid].reads, next.reads)) fresh[cuid] = true;
        });
        Object.keys(collected).forEach((cuid)=>{
            if (!(cuid in this.dependencies)) fresh[cuid] = true;
        });
        return fresh;
    };
    sameReads = (before, after)=>{
        if (before === after) return true;
        if (before.size !== after.size) return false;
        let same = true;
        before.forEach((path)=>{
            if (!after.has(path)) same = false;
        });
        return same;
    };
    recordVersions = (collected)=>{
        const versions = {};
        const record = (dependency)=>{
            if ('read' in dependency.source) {
                versions[dependency.source.getUID()] = {
                    source: dependency.source,
                    version: dependency.source.getVersion()
                };
                return;
            }
            const inner = dependency.source;
            Object.keys(inner.versions).forEach((cuid)=>{
                versions[cuid] = inner.versions[cuid];
            });
        };
        Object.keys(collected).forEach((cuid)=>{
            record(collected[cuid]);
        });
        this.versions = versions;
    };
    observeDependencies = ()=>{
        Object.keys(this.dependencies).forEach((cuid)=>{
            const dependency = this.dependencies[cuid];
            dependency.source.subscribe(this.onDependencyChanged, {
                id: this.uid,
                reads: dependency.reads
            });
        });
    };
    releaseDependencies = ()=>{
        Object.keys(this.dependencies).forEach((cuid)=>{
            this.dependencies[cuid].source.unsubscribe(this.uid);
        });
        this.dependencies = {};
    };
    onDependencyChanged = ()=>{
        if (this.valid && !this.hasDrifted()) return;
        this.markStale();
        if (updateWave.isActive()) return void updateWave.defer(this.uid, this.settle);
        this.settle();
    };
    markStale = ()=>{
        this.valid = false;
        Object.keys(this.subscribers).forEach((id)=>{
            const callback = this.subscribers[id];
            if (!callback) return;
            const mark = invalidationEdges.get(callback);
            if (mark) mark();
        });
    };
    settle = ()=>{
        const previous = this.value;
        if (!this.valid || this.hasDrifted()) this.recompute();
        const baseline = void 0 !== this.announced ? this.announced.value : previous;
        if (Object.is(baseline, this.value)) return;
        this.announced = {
            value: this.value
        };
        this.version++;
        this.deliver();
    };
    deliver = ()=>{
        const failures = [];
        Object.keys(this.subscribers).forEach((id)=>{
            const callback = this.subscribers[id];
            if (callback) try {
                callback();
            } catch (error) {
                failures.push(error);
            }
        });
        failures.forEach((error)=>{
            if ("u" > typeof process && 'production' !== process.env.NODE_ENV) diagnostics.report('a subscriber threw while a computed value was delivered: ' + (error instanceof Error ? error.message : String(error)) + '. The remaining subscribers were notified anyway.');
        });
    };
}
export { Computed };
