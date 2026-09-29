import { getUid } from "../Store/Utils/getUid.mjs";
import { sharedSingleton } from "../Store/Utils/sharedSingleton.mjs";
import { updateWave } from "../Store/Scheduling/UpdateWaveInstance.mjs";
import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
import { diagnostics } from "../Store/Diagnostics/DiagnosticsInstance.mjs";
import { transferReads } from "../Store/Paths/Markers/transferReads.mjs";
import { announceIsUnchanged } from "./announceIsUnchanged.mjs";
import { reportComputedEscape } from "./reportComputedEscape.mjs";
const invalidationEdges = sharedSingleton('invalidationEdges', ()=>new WeakMap());
class Computed {
    body;
    options;
    uid = getUid();
    version = 0;
    subscribers = new Map();
    dependencies = {};
    versions = {};
    announced = void 0;
    value = void 0;
    valid = false;
    constructor(body, options = {}){
        this.body = body;
        this.options = options;
        invalidationEdges.set(this.onDependencyChanged, this.markStale);
    }
    getUID() {
        return this.uid;
    }
    getVersion() {
        return this.version;
    }
    get() {
        if (this.isStale()) this.recompute();
        return this.value;
    }
    subscribe(callback, options = {}) {
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
    }
    unsubscribe(id) {
        if (!this.subscribers.has(id)) return;
        this.subscribers.delete(id);
        if (0 === this.subscribers.size) {
            this.releaseDependencies();
            this.valid = false;
        }
    }
    isStale() {
        if (this.subscribers.size > 0) return !this.valid;
        return !this.valid || this.hasDrifted();
    }
    hasDrifted() {
        for(const cuid in this.versions){
            const recorded = this.versions[cuid];
            if (recorded.source.getVersion() !== recorded.version) return true;
        }
        return false;
    }
    driftedSince(record) {
        for(const cuid in record){
            const recorded = record[cuid];
            if (recorded.source.getVersion() !== recorded.version) return true;
        }
        for(const cuid in this.versions)if (!(cuid in record)) return true;
        return false;
    }
    recompute() {
        const collected = {};
        const track = (source)=>{
            const cuid = source.getUID();
            let dependency = collected[cuid];
            if (!dependency) {
                dependency = {
                    source,
                    reads: new Set(),
                    published: false,
                    previous: this.dependencies[cuid],
                    overlap: 0
                };
                collected[cuid] = dependency;
            }
            if ('read' in source) return source.read((path)=>{
                this.recordDependencyRead(dependency, path);
            });
            this.recordDependencyRead(dependency, WILDCARD_PATH);
            return source.get();
        };
        this.value = this.body(track);
        this.valid = true;
        this.attachDependencies(collected);
    }
    recordDependencyRead(dependency, path) {
        var _dependency_previous;
        if (dependency.reads.has(path)) return;
        dependency.reads.add(path);
        if (void 0 !== dependency.previous && dependency.reads.size > dependency.previous.reads.size) dependency.previous = void 0;
        else if (null == (_dependency_previous = dependency.previous) ? void 0 : _dependency_previous.reads.has(path)) dependency.overlap++;
        if (dependency.published && "u" > typeof process && 'production' !== process.env.NODE_ENV) reportComputedEscape(this, (id)=>this.subscribers.has(id));
        if (dependency.published && this.subscribers.size > 0 && dependency.source.extend) dependency.source.extend(this.uid, path);
    }
    attachDependencies(collected) {
        const fresh = this.diffDependencies(collected);
        this.dependencies = collected;
        this.recordVersions(collected);
        if (0 === this.subscribers.size) return;
        Object.keys(collected).forEach((cuid)=>{
            if (!fresh[cuid]) return;
            const dependency = collected[cuid];
            dependency.source.subscribe(this.onDependencyChanged, transferReads(dependency.reads, this.uid));
        });
    }
    diffDependencies(collected) {
        const fresh = {};
        Object.keys(this.dependencies).forEach((cuid)=>{
            const previous = this.dependencies[cuid];
            const next = collected[cuid];
            previous.published = false;
            if (!next) return void previous.source.unsubscribe(this.uid);
            if (next.overlap !== previous.reads.size || next.overlap !== next.reads.size) fresh[cuid] = true;
        });
        Object.keys(collected).forEach((cuid)=>{
            const dependency = collected[cuid];
            dependency.published = true;
            dependency.previous = void 0;
            if (!(cuid in this.dependencies)) fresh[cuid] = true;
        });
        return fresh;
    }
    recordVersions(collected) {
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
    }
    observeDependencies() {
        Object.keys(this.dependencies).forEach((cuid)=>{
            const dependency = this.dependencies[cuid];
            dependency.source.subscribe(this.onDependencyChanged, transferReads(dependency.reads, this.uid));
        });
    }
    releaseDependencies() {
        Object.keys(this.dependencies).forEach((cuid)=>{
            this.dependencies[cuid].source.unsubscribe(this.uid);
        });
        this.dependencies = {};
    }
    onDependencyChanged = ()=>{
        if (this.valid && !this.hasDrifted()) return;
        this.markStale();
        if (updateWave.isActive()) return void updateWave.defer(this.uid, this.settle);
        this.settle();
    };
    markStale = ()=>{
        if (!this.valid) return;
        this.valid = false;
        for (const callback of this.subscribers.values()){
            const mark = invalidationEdges.get(callback);
            if (mark) mark();
        }
    };
    settle = ()=>{
        const previous = this.value;
        if (!this.valid || this.hasDrifted()) this.recompute();
        const moved = void 0 !== this.announced && this.driftedSince(this.announced.versions);
        const unchanged = announceIsUnchanged(this.announced, previous, this.value, moved, this.options.equals);
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
    deliver() {
        let failures;
        const single = 1 === this.subscribers.size;
        const ids = single ? this.subscribers.keys() : Array.from(this.subscribers.keys());
        for (const id of ids){
            try {
                var _this_subscribers_get;
                null == (_this_subscribers_get = this.subscribers.get(id)) || _this_subscribers_get();
            } catch (error) {
                (failures ?? (failures = [])).push(error);
            }
            if (single) break;
        }
        if (!failures) return;
        failures.forEach((error)=>{
            if ("u" > typeof process && 'production' !== process.env.NODE_ENV) diagnostics.report('a subscriber threw while a computed value was delivered: ' + (error instanceof Error ? error.message : String(error)) + '. The remaining subscribers were notified anyway.');
        });
    }
}
export { Computed };
