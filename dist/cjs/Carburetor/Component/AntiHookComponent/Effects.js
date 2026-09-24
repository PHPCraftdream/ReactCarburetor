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
    AntiHookComponentEffects: ()=>AntiHookComponentEffects
});
const DiagnosticsInstance_js_namespaceObject = require("../../Store/Diagnostics/DiagnosticsInstance.js");
const external_Reads_js_namespaceObject = require("./Reads.js");
const external_shallowEqual_js_namespaceObject = require("../shallowEqual.js");
const describeFailure = (error)=>error instanceof Error ? error.message : String(error);
class AntiHookComponentEffects extends external_Reads_js_namespaceObject.AntiHookComponentReads {
    useEffects() {}
    unUseEffects(_prevProps) {}
    reportTeardownFailure = (failure)=>{
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV) DiagnosticsInstance_js_namespaceObject.diagnostics.report(failure);
    };
    runTeardownStage = (what, stage, failures)=>{
        try {
            stage();
        } catch (error) {
            failures.push(what + ': ' + describeFailure(error) + '. The teardown completed anyway.');
        }
    };
    useEffect = (callBack, name, deps)=>{
        const known = this.effects[name];
        if (known && (0, external_shallowEqual_js_namespaceObject.shallowEqual)(known.deps, deps)) return;
        const failures = [];
        if (known && known.cleanup) try {
            known.cleanup();
        } catch (error) {
            failures.push(error);
        }
        const record = {
            deps,
            cleanup: void 0
        };
        this.effects[name] = record;
        try {
            const cleanup = callBack();
            record.cleanup = 'function' == typeof cleanup ? cleanup : void 0;
        } finally{
            failures.forEach((error)=>this.reportTeardownFailure('an effect cleanup threw while an effect was replaced: ' + describeFailure(error) + '. The new effect ran anyway.'));
        }
    };
    releaseEffects() {
        const records = this.effects;
        this.effects = {};
        const failures = [];
        Object.keys(records).forEach((name)=>{
            const cleanup = records[name].cleanup;
            if (cleanup) try {
                cleanup();
            } catch (error) {
                failures.push(error);
            }
        });
        failures.forEach((error)=>this.reportTeardownFailure('an effect cleanup threw while a component unmounted: ' + describeFailure(error) + '. The teardown completed anyway.'));
    }
}
exports.AntiHookComponentEffects = __webpack_exports__.AntiHookComponentEffects;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "AntiHookComponentEffects"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
