import { getUid } from "../Store/Utils/getUid.mjs";
import { sharedSingleton } from "../Store/Utils/sharedSingleton.mjs";
import { updateWave } from "../Store/Scheduling/UpdateWaveInstance.mjs";
import { nativeStoreWriteEpoch } from "../Store/Scheduling/nativeStoreWriteEpoch.mjs";
import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
import { diagnostics } from "../Store/Diagnostics/DiagnosticsInstance.mjs";
import { transferReads } from "../Store/Paths/Markers/transferReads.mjs";
import { announceIsUnchanged } from "./Freshness/announceIsUnchanged.mjs";
import { reportComputedEscape } from "./reportComputedEscape.mjs";
import { captureLeafVersions } from "./Freshness/captureLeafVersions.mjs";
import { driftedSince } from "./Freshness/driftedSince.mjs";
import { leafVersionsDrifted } from "./Freshness/leafVersionsDrifted.mjs";
import { computedDependencies } from "./computedDependencies.mjs";
const invalidationEdges = sharedSingleton('invalidationEdges', ()=>new WeakMap());
const ownDependency = (record, id)=>Object.prototype.hasOwnProperty.call(record, id) ? record[id] : void 0;
class Computed {
    body;
    options;
    uid = getUid();
    version = 0;
    snapshotRevision = 0;
    subscribers = new Map();
    subscriptionGeneration = 0;
    dependencies = {};
    versions = {};
    allNativeSources = true;
    validatedEpoch = nativeStoreWriteEpoch.value;
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
    getSnapshotVersion() {
        return this.version + this.snapshotRevision;
    }
    get() {
        if (this.isStale()) this.recompute();
        return this.value;
    }
    subscribe(callback, options = {}) {
        const id = options.id || getUid();
        const wasUnobserved = 0 === this.subscribers.size;
        const previous = this.subscribers.get(id);
        this.subscribers.set(id, {
            callback,
            generation: ++this.subscriptionGeneration
        });
        try {
            if (!this.valid || wasUnobserved && this.hasDrifted()) this.recompute(wasUnobserved);
            else if (wasUnobserved) this.attachDependencies(this.dependencies);
            if (wasUnobserved && this.valid) this.announced = {
                value: this.value,
                versions: this.versions
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
        return !this.valid || this.hasDrifted();
    }
    hasDrifted() {
        const epoch = nativeStoreWriteEpoch.value;
        if (this.allNativeSources && this.validatedEpoch === epoch) return false;
        if (leafVersionsDrifted(this.versions, this.dependencies)) return true;
        this.validatedEpoch = epoch;
        return false;
    }
    recompute(wasUnobserved = 0 === this.subscribers.size) {
        const collected = {};
        const track = (source)=>{
            const cuid = ':' + source.getUID();
            let dependency = ownDependency(collected, cuid);
            if (!dependency) {
                dependency = {
                    source,
                    reads: new Set(),
                    published: false,
                    observed: false,
                    previous: ownDependency(this.dependencies, cuid),
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
        const previous = this.value;
        const hadValue = this.valid || Object.keys(this.versions).length > 0;
        const oldVersions = this.versions;
        const value = this.body(track);
        this.attachDependencies(collected);
        this.value = value;
        this.valid = true;
        if (wasUnobserved && hadValue && driftedSince(oldVersions, this.versions) && !announceIsUnchanged(void 0, previous, value, true, this.options.equals)) this.snapshotRevision++;
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
        const previousAllNative = this.allNativeSources;
        const previousEpoch = this.validatedEpoch;
        this.recordVersions(collected);
        if (!fresh) {
            for (const cuid of Object.keys(this.dependencies)){
                const previous = this.dependencies[cuid];
                const next = ownDependency(collected, cuid);
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
            if (this.subscribers.size > 0) for (const cuid of fresh){
                const dependency = collected[cuid];
                attempted.push(cuid);
                computedDependencies.subscribe(dependency.source, this.onDependencyChanged, transferReads(dependency.reads, this.uid));
            }
        } catch (error) {
            for (const cuid of attempted.reverse()){
                const previous = ownDependency(this.dependencies, cuid);
                try {
                    if ((null == previous ? void 0 : previous.observed) && previous.source === collected[cuid].source) computedDependencies.subscribe(previous.source, this.onDependencyChanged, transferReads(previous.reads, this.uid));
                    else computedDependencies.unsubscribe(collected[cuid].source, this.uid);
                } catch  {}
            }
            this.versions = previousVersions;
            this.allNativeSources = previousAllNative;
            this.validatedEpoch = previousEpoch;
            this.valid = false;
            throw error;
        }
        for (const cuid of Object.keys(this.dependencies)){
            var _ownDependency;
            const previous = this.dependencies[cuid];
            previous.published = false;
            if (previous.observed && previous.source !== (null == (_ownDependency = ownDependency(collected, cuid)) ? void 0 : _ownDependency.source)) computedDependencies.unsubscribe(previous.source, this.uid);
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
        let fresh;
        for (const cuid of Object.keys(collected)){
            const next = collected[cuid];
            const previous = ownDependency(this.dependencies, cuid);
            if (!(null == previous ? void 0 : previous.observed) || next.source !== previous.source || next !== previous && (next.overlap !== previous.reads.size || next.overlap !== next.reads.size)) (fresh ?? (fresh = [])).push(cuid);
        }
        return fresh;
    }
    recordVersions(collected) {
        const versions = {};
        const allNative = captureLeafVersions(collected, versions);
        this.versions = versions;
        this.allNativeSources = allNative;
        this.validatedEpoch = nativeStoreWriteEpoch.value;
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
        this.dependencies = {};
    }
    onDependencyChanged = ()=>{
        if (this.valid && !this.hasDrifted()) {
            if (void 0 === this.announced || !driftedSince(this.announced.versions, this.versions)) return;
        } else this.markStale();
        if (updateWave.isActive()) return void updateWave.defer(this.uid, this.settle);
        this.settle();
    };
    markStale = ()=>{
        if (!this.valid) return;
        this.valid = false;
        for (const record of this.subscribers.values()){
            const mark = invalidationEdges.get(record.callback);
            if (mark) mark();
        }
    };
    settle = ()=>{
        const previous = this.value;
        if (!this.valid || this.hasDrifted()) this.recompute();
        const moved = void 0 !== this.announced && driftedSince(this.announced.versions, this.versions);
        const unchanged = announceIsUnchanged(this.announced, previous, this.value, moved, this.options.equals);
        if (unchanged) return;
        this.announced = {
            value: this.value,
            versions: this.versions
        };
        this.version++;
        this.deliver();
    };
    deliver() {
        let failures;
        const generation = this.subscriptionGeneration;
        const single = 1 === this.subscribers.size;
        const ids = single ? this.subscribers.keys() : Array.from(this.subscribers.keys());
        for (const id of ids){
            const record = this.subscribers.get(id);
            if (record && record.generation <= generation) try {
                record.callback();
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
