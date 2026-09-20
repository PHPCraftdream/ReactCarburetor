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
    transaction: ()=>transaction
});
const DiagnosticsInstance_js_namespaceObject = require("../Diagnostics/DiagnosticsInstance.js");
const external_UpdateBatchInstance_js_namespaceObject = require("./UpdateBatchInstance.js");
const isThenable = (value)=>{
    if ('object' != typeof value || null === value) return false;
    return 'function' == typeof value.then;
};
const transaction = (body)=>{
    external_UpdateBatchInstance_js_namespaceObject.updateBatch.begin();
    try {
        const result = body();
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV && isThenable(result)) DiagnosticsInstance_js_namespaceObject.diagnostics.report("transaction() was given an async body. The batch closes when the body returns, so only the writes before its first await are batched. Wrap the synchronous write block in transaction() instead.");
        return result;
    } finally{
        external_UpdateBatchInstance_js_namespaceObject.updateBatch.end();
    }
};
exports.transaction = __webpack_exports__.transaction;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "transaction"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
