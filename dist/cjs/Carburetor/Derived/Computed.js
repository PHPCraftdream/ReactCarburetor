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
    Computed: ()=>Computed
});
const getUid_js_namespaceObject = require("../Store/Utils/getUid.js");
const sharedSingleton_js_namespaceObject = require("../Store/Utils/sharedSingleton.js");
const UpdateWaveInstance_js_namespaceObject = require("../Store/Scheduling/UpdateWaveInstance.js");
const nativeStoreWriteEpoch_js_namespaceObject = require("../Store/Scheduling/nativeStoreWriteEpoch.js");
const WildcardPath_js_namespaceObject = require("../Store/Paths/WildcardPath.js");
const DiagnosticsInstance_js_namespaceObject = require("../Store/Diagnostics/DiagnosticsInstance.js");
const transferReads_js_namespaceObject = require("../Store/Paths/Markers/transferReads.js");
const announceIsUnchanged_js_namespaceObject = require("./Freshness/announceIsUnchanged.js");
const external_reportComputedEscape_js_namespaceObject = require("./reportComputedEscape.js");
const captureLeafVersions_js_namespaceObject = require("./Freshness/captureLeafVersions.js");
const driftedSince_js_namespaceObject = require("./Freshness/driftedSince.js");
const leafVersionsDrifted_js_namespaceObject = require("./Freshness/leafVersionsDrifted.js");
const external_computedDependencies_js_namespaceObject = require("./computedDependencies.js");
const invalidationEdges = (0, sharedSingleton_js_namespaceObject.sharedSingleton)('invalidationEdges', ()=>new WeakMap());
const ownDependency = (record, id)=>Object.prototype.hasOwnProperty.call(record, id) ? record[id] : void 0;
class Computed {
    body;
    options;
    uid = (0, getUid_js_namespaceObject.getUid)();
    version = 0;
    snapshotRevision = 0;
    subscribers = new Map();
    subscriptionGeneration = 0;
    dependencies = {};
    versions = {};
    allNativeSources = true;
    validatedEpoch = nativeStoreWriteEpoch_js_namespaceObject.nativeStoreWriteEpoch.value;
    announced = void 0;
    value = void 0;
    valid = false;
    constructor(body, options = {}){
        this.body = body;
        this.options = options;
        invalidationEdges.set(this.onDependencyChanged, this.markStale);
        external_computedDependencies_js_namespaceObject.computedDependencies.versions.set(this, ()=>this.versions);
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
        const id = options.id || (0, getUid_js_namespaceObject.getUid)();
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
        const epoch = nativeStoreWriteEpoch_js_namespaceObject.nativeStoreWriteEpoch.value;
        if (this.allNativeSources && this.validatedEpoch === epoch) return false;
        if ((0, leafVersionsDrifted_js_namespaceObject.leafVersionsDrifted)(this.versions, this.dependencies)) return true;
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
            this.recordDependencyRead(dependency, WildcardPath_js_namespaceObject.WILDCARD_PATH);
            return source.get();
        };
        const previous = this.value;
        const hadValue = this.valid || Object.keys(this.versions).length > 0;
        const oldVersions = this.versions;
        const value = this.body(track);
        this.attachDependencies(collected);
        this.value = value;
        this.valid = true;
        if (wasUnobserved && hadValue && (0, driftedSince_js_namespaceObject.driftedSince)(oldVersions, this.versions) && !(0, announceIsUnchanged_js_namespaceObject.announceIsUnchanged)(void 0, previous, value, true, this.options.equals)) this.snapshotRevision++;
    }
    recordDependencyRead(dependency, path) {
        var _dependency_previous;
        if (dependency.reads.has(path)) return;
        dependency.reads.add(path);
        if (void 0 !== dependency.previous && dependency.reads.size > dependency.previous.reads.size) dependency.previous = void 0;
        else if (null == (_dependency_previous = dependency.previous) ? void 0 : _dependency_previous.reads.has(path)) dependency.overlap++;
        if (dependency.published && "u" > typeof process && 'production' !== process.env.NODE_ENV) (0, external_reportComputedEscape_js_namespaceObject.reportComputedEscape)(this, (id)=>this.subscribers.has(id));
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
                } else if (previous.observed) external_computedDependencies_js_namespaceObject.computedDependencies.unsubscribe(previous.source, this.uid);
            }
            this.dependencies = collected;
            return;
        }
        const attempted = [];
        try {
            if (this.subscribers.size > 0) for (const cuid of fresh){
                const dependency = collected[cuid];
                attempted.push(cuid);
                external_computedDependencies_js_namespaceObject.computedDependencies.subscribe(dependency.source, this.onDependencyChanged, (0, transferReads_js_namespaceObject.transferReads)(dependency.reads, this.uid));
            }
        } catch (error) {
            for (const cuid of attempted.reverse()){
                const previous = ownDependency(this.dependencies, cuid);
                try {
                    if ((null == previous ? void 0 : previous.observed) && previous.source === collected[cuid].source) external_computedDependencies_js_namespaceObject.computedDependencies.subscribe(previous.source, this.onDependencyChanged, (0, transferReads_js_namespaceObject.transferReads)(previous.reads, this.uid));
                    else external_computedDependencies_js_namespaceObject.computedDependencies.unsubscribe(collected[cuid].source, this.uid);
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
            if (previous.observed && previous.source !== (null == (_ownDependency = ownDependency(collected, cuid)) ? void 0 : _ownDependency.source)) external_computedDependencies_js_namespaceObject.computedDependencies.unsubscribe(previous.source, this.uid);
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
        const allNative = (0, captureLeafVersions_js_namespaceObject.captureLeafVersions)(collected, versions);
        this.versions = versions;
        this.allNativeSources = allNative;
        this.validatedEpoch = nativeStoreWriteEpoch_js_namespaceObject.nativeStoreWriteEpoch.value;
    }
    releaseDependencies() {
        Object.keys(this.dependencies).forEach((cuid)=>{
            const dependency = this.dependencies[cuid];
            dependency.published = false;
            if (dependency.observed) {
                external_computedDependencies_js_namespaceObject.computedDependencies.unsubscribe(dependency.source, this.uid);
                dependency.observed = false;
            }
        });
        this.dependencies = {};
    }
    onDependencyChanged = ()=>{
        if (this.valid && !this.hasDrifted()) {
            if (void 0 === this.announced || !(0, driftedSince_js_namespaceObject.driftedSince)(this.announced.versions, this.versions)) return;
        } else this.markStale();
        if (UpdateWaveInstance_js_namespaceObject.updateWave.isActive()) return void UpdateWaveInstance_js_namespaceObject.updateWave.defer(this.uid, this.settle);
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
        const moved = void 0 !== this.announced && (0, driftedSince_js_namespaceObject.driftedSince)(this.announced.versions, this.versions);
        const unchanged = (0, announceIsUnchanged_js_namespaceObject.announceIsUnchanged)(this.announced, previous, this.value, moved, this.options.equals);
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
            if ("u" > typeof process && 'production' !== process.env.NODE_ENV) DiagnosticsInstance_js_namespaceObject.diagnostics.report('a subscriber threw while a computed value was delivered: ' + (error instanceof Error ? error.message : String(error)) + '. The remaining subscribers were notified anyway.');
        });
    }
}
exports.Computed = __webpack_exports__.Computed;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "Computed"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
