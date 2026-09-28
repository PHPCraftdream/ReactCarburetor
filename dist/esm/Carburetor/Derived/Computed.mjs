import { containsExoticValue } from "../Store/Utils/containsExoticValue.mjs";
import { getUid } from "../Store/Utils/getUid.mjs";
import { sharedSingleton } from "../Store/Utils/sharedSingleton.mjs";
import { updateWave } from "../Store/Scheduling/UpdateWaveInstance.mjs";
import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
import { diagnostics } from "../Store/Diagnostics/DiagnosticsInstance.mjs";
const invalidationEdges = sharedSingleton('invalidationEdges', ()=>new WeakMap());
class Computed {
    body;
    uid = getUid();
    version = 0;
    subscribers = new Map();
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
        const wasUnobserved = 0 === this.subscribers.size;
        this.subscribers.set(id, callback);
        if (!this.valid || wasUnobserved && this.hasDrifted()) this.recompute();
        else if (wasUnobserved) this.observeDependencies();
        if (wasUnobserved && this.valid) this.announced = {
            value: this.value,
            versions: {
                ...this.versions
            }
        };
        return id;
    };
    unsubscribe = (id)=>{
        if (!this.subscribers.has(id)) return;
        this.subscribers.delete(id);
        if (0 === this.subscribers.size) {
            this.releaseDependencies();
            this.valid = false;
        }
    };
    isStale = ()=>{
        if (this.subscribers.size > 0) return !this.valid;
        return !this.valid || this.hasDrifted();
    };
    hasDrifted = ()=>{
        for(const cuid in this.versions){
            const recorded = this.versions[cuid];
            if (recorded.source.getVersion() !== recorded.version) return true;
        }
        return false;
    };
    driftedSince = (record)=>{
        for(const cuid in record){
            const recorded = record[cuid];
            if (recorded.source.getVersion() !== recorded.version) return true;
        }
        for(const cuid in this.versions)if (!(cuid in record)) return true;
        return false;
    };
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
                this.recordDependencyRead(dependency, path);
            });
            dependency.reads.add(WILDCARD_PATH);
            return source.get();
        };
        this.value = this.body(track);
        this.valid = true;
        this.attachDependencies(collected);
    };
    recordDependencyRead = (dependency, path)=>{
        if (dependency.reads.has(path)) return;
        dependency.reads.add(path);
        const published = dependency === this.dependencies[dependency.source.getUID()];
        const observed = this.subscribers.size > 0;
        if (published && observed) dependency.source.subscribe(this.onDependencyChanged, {
            id: this.uid,
            reads: dependency.reads
        });
    };
    attachDependencies = (collected)=>{
        const fresh = this.diffDependencies(collected);
        this.dependencies = collected;
        this.recordVersions(collected);
        if (0 === this.subscribers.size) return;
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
        const ids = Array.from(this.subscribers.keys());
        ids.forEach((id)=>{
            const callback = this.subscribers.get(id);
            if (!callback) return;
            const mark = invalidationEdges.get(callback);
            if (mark) mark();
        });
    };
    settle = ()=>{
        const previous = this.value;
        if (!this.valid || this.hasDrifted()) this.recompute();
        const baseline = void 0 !== this.announced ? this.announced.value : previous;
        const sameReference = Object.is(baseline, this.value);
        const moved = void 0 !== this.announced && this.driftedSince(this.announced.versions);
        const opaqueChanged = sameReference && moved && containsExoticValue(this.value);
        const unchanged = sameReference && !opaqueChanged;
        if (unchanged) return;
        this.announced = {
            value: this.value,
            versions: {
                ...this.versions
            }
        };
        this.version++;
        this.deliver();
    };
    deliver = ()=>{
        const failures = [];
        const ids = Array.from(this.subscribers.keys());
        ids.forEach((id)=>{
            const callback = this.subscribers.get(id);
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
