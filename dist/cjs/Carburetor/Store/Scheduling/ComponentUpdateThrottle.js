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
    ComponentUpdateThrottle: ()=>ComponentUpdateThrottle
});
const DiagnosticsInstance_js_namespaceObject = require("../Diagnostics/DiagnosticsInstance.js");
class ComponentUpdateThrottle {
    updateTimeout;
    maxUpdateDepth = 50;
    timeout = void 0;
    updaters = new Map();
    constructor(updateTimeout = 40){
        this.updateTimeout = updateTimeout;
    }
    schedule = (uid, updater)=>{
        this.updaters.set(uid, updater);
        this.setupTimeout();
    };
    cancel = (uid)=>{
        this.updaters.delete(uid);
    };
    setupTimeout = ()=>{
        if (!this.timeout) this.timeout = setTimeout(this.letsUpdate, this.updateTimeout);
    };
    clearTimeout = ()=>{
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = void 0;
    };
    runUpdater = (updater)=>{
        updater();
    };
    letsUpdate = ()=>{
        let depth = 0;
        const failures = [];
        try {
            while(this.updaters.size > 0){
                if (depth++ >= this.maxUpdateDepth) {
                    this.updaters.clear();
                    throw new Error('ComponentUpdateThrottle: exceeded max update depth of ' + this.maxUpdateDepth + '. An updater keeps scheduling new updates — this is an infinite update loop.');
                }
                const batch = Array.from(this.updaters.values());
                this.updaters.clear();
                batch.forEach((updater)=>{
                    try {
                        this.runUpdater(updater);
                    } catch (error) {
                        failures.push(error);
                    }
                });
            }
        } finally{
            failures.forEach((error)=>{
                if ("u" > typeof process && 'production' !== process.env.NODE_ENV) DiagnosticsInstance_js_namespaceObject.diagnostics.report('an updater threw while the throttle flushed: ' + (error instanceof Error ? error.message : String(error)) + '. The remaining updaters in the batch were run anyway.');
            });
            this.clearTimeout();
        }
    };
}
exports.ComponentUpdateThrottle = __webpack_exports__.ComponentUpdateThrottle;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "ComponentUpdateThrottle"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
