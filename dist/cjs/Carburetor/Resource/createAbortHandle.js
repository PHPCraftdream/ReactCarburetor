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
    createAbortHandle: ()=>createAbortHandle
});
const DiagnosticsInstance_js_namespaceObject = require("../Store/Diagnostics/DiagnosticsInstance.js");
let reported = false;
const createAbortHandle = ()=>{
    if ('function' == typeof AbortController) return new AbortController();
    if ("u" > typeof process && 'production' !== process.env.NODE_ENV && !reported) {
        reported = true;
        DiagnosticsInstance_js_namespaceObject.diagnostics.report("this runtime has no AbortController (Node added one in 14.17.0; the advertised floor is 14.6.0), so resource requests degrade to unabortable: the loader is handed a signal that never fires, and abort() can only keep a late answer from being stored, not stop the request itself.");
    }
    const handle = {
        signal: {
            aborted: false
        },
        abort () {
            handle.signal.aborted = true;
        }
    };
    return handle;
};
exports.createAbortHandle = __webpack_exports__.createAbortHandle;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createAbortHandle"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
