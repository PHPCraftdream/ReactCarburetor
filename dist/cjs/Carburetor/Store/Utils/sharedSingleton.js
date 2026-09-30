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
    sharedSingleton: ()=>sharedSingleton
});
const DiagnosticsInstance_js_namespaceObject = require("../Diagnostics/DiagnosticsInstance.js");
const copyMarker = {};
const sharedSingleton = (name, create, react)=>{
    const registry = globalThis;
    const key = Symbol.for(`react-carburetor/v1/${name}`);
    const existing = registry[key];
    if (existing) {
        const foreignCopy = existing.copy !== copyMarker;
        const foreignReact = void 0 !== react && existing.react !== react;
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV && (foreignCopy || foreignReact) && !existing.reported) {
            existing.reported = true;
            DiagnosticsInstance_js_namespaceObject.diagnostics.report(`two copies of react-carburetor share this process for "${name}" — a duplicated install, or the package loaded through two different module formats at once. Dedupe the install, or make sure only one module format is loaded.` + (foreignReact ? ' The copies also imported different React modules — align them to one React install.' : ''));
        }
        return existing.value;
    }
    const created = {
        value: create(),
        copy: copyMarker,
        react,
        reported: false
    };
    registry[key] = created;
    return created.value;
};
exports.sharedSingleton = __webpack_exports__.sharedSingleton;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "sharedSingleton"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
