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
const UpdateWaveInstance_js_namespaceObject = require("../Store/Scheduling/UpdateWaveInstance.js");
const WildcardPath_js_namespaceObject = require("../Store/Paths/WildcardPath.js");
const DiagnosticsInstance_js_namespaceObject = require("../Store/Diagnostics/DiagnosticsInstance.js");
class Computed {
    body;
    uid = (0, getUid_js_namespaceObject.getUid)();
    version = 0;
    subscribers = {};
    dependencies = {};
    versions = {};
    announced = void 0;
    value = void 0;
    valid = false;
    constructor(body){
        this.body = body;
    }
    getUID = ()=>this.uid;
    getVersion = ()=>this.version;
    get = ()=>{
        if (this.isStale()) this.recompute();
        return this.value;
    };
    subscribe = (callback, options = {})=>{
        const id = options.id || (0, getUid_js_namespaceObject.getUid)();
        const wasUnobserved = 0 === Object.keys(this.subscribers).length;
        this.subscribers[id] = callback;
        if (!this.valid || wasUnobserved && this.hasDrifted()) this.recompute();
        else if (wasUnobserved) this.observeDependencies();
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
            dependency.reads.add(WildcardPath_js_namespaceObject.WILDCARD_PATH);
            return source.get();
        };
        this.value = this.body(track);
        this.valid = true;
        this.attachDependencies(collected);
    };
    attachDependencies = (collected)=>{
        this.releaseDependencies();
        this.dependencies = collected;
        this.recordVersions(collected);
        if (0 === Object.keys(this.subscribers).length) return;
        this.observeDependencies();
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
        this.valid = false;
        if (UpdateWaveInstance_js_namespaceObject.updateWave.isActive()) return void UpdateWaveInstance_js_namespaceObject.updateWave.defer(this.uid, this.settle);
        this.settle();
    };
    settle = ()=>{
        const previous = this.value;
        this.recompute();
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
            if ("u" > typeof process && 'production' !== process.env.NODE_ENV) DiagnosticsInstance_js_namespaceObject.diagnostics.report('a subscriber threw while a computed value was delivered: ' + (error instanceof Error ? error.message : String(error)) + '. The remaining subscribers were notified anyway.');
        });
    };
}
exports.Computed = __webpack_exports__.Computed;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "Computed"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
