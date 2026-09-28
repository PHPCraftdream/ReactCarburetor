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
    CarburetorHistory: ()=>CarburetorHistory
});
const Paths_js_namespaceObject = require("../Models/Paths.js");
const installPatch_js_namespaceObject = require("../Store/Paths/Diff/installPatch.js");
const deepClone_js_namespaceObject = require("../Store/Utils/deepClone.js");
class CarburetorHistory {
    carburetor;
    past = [];
    future = [];
    baseline;
    limit;
    applying = false;
    dispose;
    pendingPatches = [];
    pendingOpaque = false;
    recordBound = ()=>this.record();
    onPatchBound = (patch)=>this.onPatch(patch);
    constructor(carburetor, options = {}){
        this.carburetor = carburetor;
        this.limit = options.limit || 50;
        this.baseline = carburetor.snapshot();
        const detachPatches = carburetor.attachPatchListener(this.onPatchBound);
        const subscriptionId = carburetor.subscribe(this.recordBound);
        this.dispose = ()=>{
            detachPatches();
            carburetor.unsubscribe(subscriptionId);
        };
    }
    canUndo() {
        return this.past.length > 0;
    }
    canRedo() {
        return this.future.length > 0;
    }
    undo() {
        const entry = this.past.pop();
        if (void 0 === entry) return false;
        this.future.push(entry);
        this.apply(entry, true);
        return true;
    }
    redo() {
        const entry = this.future.pop();
        if (void 0 === entry) return false;
        this.past.push(entry);
        this.apply(entry, false);
        return true;
    }
    clear() {
        this.past = [];
        this.future = [];
    }
    disconnect() {
        this.dispose();
    }
    onPatch(patch) {
        if (this.applying) return;
        if (patch === Paths_js_namespaceObject.PATCH_OPAQUE) {
            this.pendingOpaque = true;
            return;
        }
        this.pendingPatches.push(patch);
    }
    record() {
        if (this.applying) return;
        this.past.push(this.buildEntry());
        if (this.past.length > this.limit) this.past.shift();
        this.future = [];
        this.pendingPatches = [];
        this.pendingOpaque = false;
    }
    buildEntry() {
        if (this.pendingOpaque || 0 === this.pendingPatches.length) {
            const before = this.baseline;
            const after = this.carburetor.snapshot();
            this.baseline = (0, deepClone_js_namespaceObject.deepClone)(after);
            return {
                kind: 'snapshot',
                before,
                after
            };
        }
        const patches = this.pendingPatches;
        for (const patch of patches)(0, installPatch_js_namespaceObject.installPatch)(this.baseline, patch, false);
        return {
            kind: 'patches',
            patches
        };
    }
    apply(entry, inverse) {
        this.applying = true;
        try {
            const state = 'snapshot' === entry.kind ? inverse ? entry.before : entry.after : this.reconstruct(entry.patches, inverse);
            this.carburetor.restore(state);
            this.baseline = 'snapshot' === entry.kind ? (0, deepClone_js_namespaceObject.deepClone)(state) : state;
        } finally{
            this.applying = false;
        }
    }
    reconstruct(patches, inverse) {
        const target = (0, deepClone_js_namespaceObject.deepClone)(this.baseline);
        const ordered = inverse ? [
            ...patches
        ].reverse() : patches;
        for (const patch of ordered)(0, installPatch_js_namespaceObject.installPatch)(target, patch, inverse);
        return target;
    }
}
exports.CarburetorHistory = __webpack_exports__.CarburetorHistory;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "CarburetorHistory"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
