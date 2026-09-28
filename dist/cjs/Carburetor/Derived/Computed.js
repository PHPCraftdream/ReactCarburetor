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
const WildcardPath_js_namespaceObject = require("../Store/Paths/WildcardPath.js");
const DiagnosticsInstance_js_namespaceObject = require("../Store/Diagnostics/DiagnosticsInstance.js");
const external_announceIsUnchanged_js_namespaceObject = require("./announceIsUnchanged.js");
const external_reportComputedEscape_js_namespaceObject = require("./reportComputedEscape.js");
const invalidationEdges = (0, sharedSingleton_js_namespaceObject.sharedSingleton)('invalidationEdges', ()=>new WeakMap());
class Computed {
    body;
    options;
    uid = (0, getUid_js_namespaceObject.getUid)();
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
        const id = options.id || (0, getUid_js_namespaceObject.getUid)();
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
            const dependency = collected[cuid] || {
                source,
                reads: new Set()
            };
            collected[cuid] = dependency;
            if ('read' in source) return source.read((path)=>{
                this.recordDependencyRead(dependency, path);
            });
            dependency.reads.add(WildcardPath_js_namespaceObject.WILDCARD_PATH);
            return source.get();
        };
        this.value = this.body(track);
        this.valid = true;
        this.attachDependencies(collected);
    }
    recordDependencyRead(dependency, path) {
        if (dependency.reads.has(path)) return;
        dependency.reads.add(path);
        const published = dependency === this.dependencies[dependency.source.getUID()];
        if (published && "u" > typeof process && 'production' !== process.env.NODE_ENV) (0, external_reportComputedEscape_js_namespaceObject.reportComputedEscape)(this, (id)=>this.subscribers.has(id));
        if (published && this.subscribers.size > 0 && dependency.source.extend) dependency.source.extend(this.uid, path);
    }
    attachDependencies(collected) {
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
    }
    diffDependencies(collected) {
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
    }
    sameReads(before, after) {
        if (before === after) return true;
        if (before.size !== after.size) return false;
        let same = true;
        before.forEach((path)=>{
            if (!after.has(path)) same = false;
        });
        return same;
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
            dependency.source.subscribe(this.onDependencyChanged, {
                id: this.uid,
                reads: dependency.reads
            });
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
        if (UpdateWaveInstance_js_namespaceObject.updateWave.isActive()) return void UpdateWaveInstance_js_namespaceObject.updateWave.defer(this.uid, this.settle);
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
        const moved = void 0 !== this.announced && this.driftedSince(this.announced.versions);
        const unchanged = (0, external_announceIsUnchanged_js_namespaceObject.announceIsUnchanged)(this.announced, previous, this.value, moved, this.options.equals);
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
