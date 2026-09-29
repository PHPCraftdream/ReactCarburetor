import { getUid } from "../Store/Utils/getUid.mjs";
import { sharedSingleton } from "../Store/Utils/sharedSingleton.mjs";
import { updateWave } from "../Store/Scheduling/UpdateWaveInstance.mjs";
import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
import { diagnostics } from "../Store/Diagnostics/DiagnosticsInstance.mjs";
import { transferReads } from "../Store/Paths/Markers/transferReads.mjs";
import { announceIsUnchanged } from "./announceIsUnchanged.mjs";
import { reportComputedEscape } from "./reportComputedEscape.mjs";
import { computedDependencies } from "./computedDependencies.mjs";
const invalidationEdges = sharedSingleton('invalidationEdges', ()=>new WeakMap());
class Computed {
    body;
    options;
    uid = getUid();
    version = 0;
    subscribers = new Map();
    dependencies = Object.create(null);
    versions = Object.create(null);
    announced = void 0;
    value = void 0;
    valid = false;
    constructor(body, options = {}){
        this.body = body;
        this.options = options;
        invalidationEdges.set(this.onDependencyChanged, this.markStale);
        computedDependencies.versions.set(this, ()=>this.versions);
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
        const previous = this.subscribers.get(id);
        this.subscribers.set(id, callback);
        try {
            if (!this.valid || wasUnobserved && this.hasDrifted()) this.recompute();
            else if (wasUnobserved) this.attachDependencies(this.dependencies);
            if (wasUnobserved && this.valid) this.announced = {
                value: this.value,
                versions: {
                    ...this.versions
                }
            };
        } catch (error) {
            if (previous) this.subscribers.set(id, previous);
            else this.subscribers.delete(id);
            this.valid = false;
            throw error;
        }
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
        const collected = Object.create(null);
        const track = (source)=>{
            const cuid = source.getUID();
            let dependency = collected[cuid];
            if (!dependency) {
                dependency = {
                    source,
                    reads: new Set(),
                    published: false,
                    observed: false,
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
        const value = this.body(track);
        this.attachDependencies(collected);
        this.value = value;
        this.valid = true;
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
        const previousVersions = this.versions;
        this.recordVersions(collected);
        let needsAttachment = false;
        for(const cuid in fresh){
            needsAttachment = fresh[cuid];
            break;
        }
        if (!needsAttachment) {
            for(const cuid in this.dependencies){
                const previous = this.dependencies[cuid];
                const next = collected[cuid];
                previous.published = false;
                if (next) {
                    next.published = true;
                    next.observed = previous.observed;
                    next.previous = void 0;
                } else if (previous.observed) computedDependencies.unsubscribe(previous.source, this.uid);
            }
            this.dependencies = collected;
            return;
        }
        const attempted = [];
        try {
            if (this.subscribers.size > 0) for (const cuid of Object.keys(fresh)){
                const dependency = collected[cuid];
                attempted.push(cuid);
                computedDependencies.subscribe(dependency.source, this.onDependencyChanged, transferReads(dependency.reads, this.uid));
            }
        } catch (error) {
            for (const cuid of attempted.reverse()){
                const previous = this.dependencies[cuid];
                try {
                    if ((null == previous ? void 0 : previous.observed) && previous.source === collected[cuid].source) computedDependencies.subscribe(previous.source, this.onDependencyChanged, transferReads(previous.reads, this.uid));
                    else computedDependencies.unsubscribe(collected[cuid].source, this.uid);
                } catch  {}
            }
            this.versions = previousVersions;
            this.valid = false;
            throw error;
        }
        for (const cuid of Object.keys(this.dependencies)){
            var _collected_cuid;
            const previous = this.dependencies[cuid];
            previous.published = false;
            if (previous.observed && previous.source !== (null == (_collected_cuid = collected[cuid]) ? void 0 : _collected_cuid.source)) computedDependencies.unsubscribe(previous.source, this.uid);
        }
        for (const cuid of Object.keys(collected)){
            const dependency = collected[cuid];
            dependency.published = true;
            dependency.observed = this.subscribers.size > 0;
            dependency.previous = void 0;
        }
        this.dependencies = collected;
    }
    diffDependencies(collected) {
        const fresh = Object.create(null);
        Object.keys(collected).forEach((cuid)=>{
            const next = collected[cuid];
            const previous = this.dependencies[cuid];
            if (!(null == previous ? void 0 : previous.observed) || next.source !== previous.source || next !== previous && (next.overlap !== previous.reads.size || next.overlap !== next.reads.size)) fresh[cuid] = true;
        });
        return fresh;
    }
    recordVersions(collected) {
        const versions = Object.create(null);
        const record = (dependency)=>{
            var _computedDependencies_versions_get;
            const innerVersions = 'read' in dependency.source ? void 0 : null == (_computedDependencies_versions_get = computedDependencies.versions.get(dependency.source)) ? void 0 : _computedDependencies_versions_get();
            if (!innerVersions) {
                versions[dependency.source.getUID()] = {
                    source: dependency.source,
                    version: dependency.source.getVersion()
                };
                return;
            }
            Object.keys(innerVersions).forEach((cuid)=>{
                versions[cuid] = innerVersions[cuid];
            });
        };
        Object.keys(collected).forEach((cuid)=>{
            record(collected[cuid]);
        });
        this.versions = versions;
    }
    releaseDependencies() {
        Object.keys(this.dependencies).forEach((cuid)=>{
            const dependency = this.dependencies[cuid];
            dependency.published = false;
            if (dependency.observed) {
                computedDependencies.unsubscribe(dependency.source, this.uid);
                dependency.observed = false;
            }
        });
        this.dependencies = Object.create(null);
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
