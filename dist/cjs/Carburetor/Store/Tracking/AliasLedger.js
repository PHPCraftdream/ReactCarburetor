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
    createAliasLedger: ()=>createAliasLedger
});
const DiagnosticsInstance_js_namespaceObject = require("../Diagnostics/DiagnosticsInstance.js");
const createAliasLedger = ()=>{
    if ("u" < typeof process || 'production' === process.env.NODE_ENV) return;
    const seen = new WeakMap();
    return {
        note: (value, path)=>{
            const found = seen.get(value);
            if (void 0 !== found && found !== path) DiagnosticsInstance_js_namespaceObject.diagnostics.report('the same object was reached at two paths, ' + found + ' and ' + path + ": reads are tracked by path, so a write through one will not wake a component reading the other. Keep the data a tree — one object, one path.");
            seen.set(value, path);
        },
        checkWrite: (source, path)=>{
            const found = seen.get(source);
            if (void 0 !== found && found !== path) DiagnosticsInstance_js_namespaceObject.diagnostics.report('a write landed in an object that was also read at ' + found + ", while the write sits at " + (path || 'the root') + ": only the written path is woken, the other never hears about it. Keep the data a tree — one object, one path.");
        },
        forget: (value)=>{
            if (null !== value && 'object' == typeof value) seen.delete(value);
        }
    };
};
exports.createAliasLedger = __webpack_exports__.createAliasLedger;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createAliasLedger"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
