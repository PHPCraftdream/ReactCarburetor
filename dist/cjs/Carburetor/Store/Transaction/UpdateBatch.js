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
    UpdateBatch: ()=>UpdateBatch
});
const UpdateWaveInstance_js_namespaceObject = require("../Scheduling/UpdateWaveInstance.js");
const DiagnosticsInstance_js_namespaceObject = require("../Diagnostics/DiagnosticsInstance.js");
class UpdateBatch {
    depth = 0;
    pending = new Map();
    isActive = ()=>this.depth > 0;
    begin = ()=>{
        this.depth++;
    };
    end = ()=>{
        this.depth--;
        if (this.depth > 0) return;
        this.depth = 0;
        this.flush();
    };
    add = (target, writes)=>{
        const merged = this.pending.get(target);
        if (!merged) return void this.pending.set(target, new Set(writes));
        writes.forEach((path)=>merged.add(path));
    };
    flush = ()=>{
        UpdateWaveInstance_js_namespaceObject.updateWave.begin();
        try {
            const failures = [];
            while(this.pending.size > 0){
                const batch = Array.from(this.pending.entries());
                this.pending.clear();
                batch.forEach(([target, writes])=>{
                    try {
                        target.notifyWrites(writes);
                    } catch (error) {
                        failures.push(error);
                    }
                });
            }
            failures.forEach((error)=>{
                if ("u" > typeof process && 'production' !== process.env.NODE_ENV) DiagnosticsInstance_js_namespaceObject.diagnostics.report('a carburetor threw while a transaction was being delivered: ' + (error instanceof Error ? error.message : String(error)) + '. The other carburetors in the batch were notified anyway.');
            });
        } finally{
            UpdateWaveInstance_js_namespaceObject.updateWave.end();
        }
    };
}
exports.UpdateBatch = __webpack_exports__.UpdateBatch;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "UpdateBatch"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
