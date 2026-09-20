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
    Computed: ()=>Computed,
    computed: ()=>computed
});
const getUid_js_namespaceObject = require("./Utils/getUid.js");
class Computed {
    body;
    uid = (0, getUid_js_namespaceObject.getUid)();
    version = 0;
    subscribers = {};
    dependencies = {};
    value = void 0;
    valid = false;
    constructor(body){
        this.body = body;
    }
    getUID = ()=>this.uid;
    getVersion = ()=>this.version;
    get = ()=>{
        if (!this.valid) this.recompute();
        return this.value;
    };
    subscribe = (callback, customId)=>{
        const id = customId || (0, getUid_js_namespaceObject.getUid)();
        const wasUnobserved = 0 === Object.keys(this.subscribers).length;
        this.subscribers[id] = callback;
        if (this.valid) {
            if (wasUnobserved) this.observeDependencies();
        } else this.recompute();
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
    recompute = ()=>{
        const collected = {};
        const read = (carburetor)=>{
            const cuid = carburetor.getUID();
            const dependency = collected[cuid] || {
                source: carburetor,
                reads: new Set()
            };
            collected[cuid] = dependency;
            return carburetor.read((path)=>{
                dependency.reads.add(path);
            });
        };
        this.value = this.body(read);
        this.valid = true;
        this.attachDependencies(collected);
    };
    attachDependencies = (collected)=>{
        this.releaseDependencies();
        this.dependencies = collected;
        if (0 === Object.keys(this.subscribers).length) return;
        this.observeDependencies();
    };
    observeDependencies = ()=>{
        Object.keys(this.dependencies).forEach((cuid)=>{
            const dependency = this.dependencies[cuid];
            dependency.source.subscribe(this.onDependencyChanged, this.uid, new Set(dependency.reads));
        });
    };
    releaseDependencies = ()=>{
        Object.keys(this.dependencies).forEach((cuid)=>{
            this.dependencies[cuid].source.unsubscribe(this.uid);
        });
        this.dependencies = {};
    };
    onDependencyChanged = ()=>{
        const previous = this.value;
        this.valid = false;
        this.recompute();
        if (Object.is(previous, this.value)) return;
        this.version++;
        Object.keys(this.subscribers).forEach((id)=>{
            const callback = this.subscribers[id];
            if (callback) callback();
        });
    };
}
const computed = (body)=>new Computed(body);
exports.Computed = __webpack_exports__.Computed;
exports.computed = __webpack_exports__.computed;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "Computed",
    "computed"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
