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
    reportComputedEscape: ()=>reportComputedEscape
});
const DiagnosticsInstance_js_namespaceObject = require("../Store/Diagnostics/DiagnosticsInstance.js");
const external_renderOwner_js_namespaceObject = require("./renderOwner.js");
const reported = new WeakSet();
const reportComputedEscape = (source, isSubscriber)=>{
    if (reported.has(source)) return;
    const owner = external_renderOwner_js_namespaceObject.renderOwner.get();
    if (void 0 === owner || isSubscriber(owner.uid) || owner.hasTracked(source)) return;
    reported.add(source);
    DiagnosticsInstance_js_namespaceObject.diagnostics.report("a component rendered through a computed's live result without subscribing to it: the value reached it through props instead of its own useComputed() call. A write inside the result then re-renders the whole tree that produced it, not just this component. Return ids or plain values from the computed and read the store in the row, or pass {equals} so an unaffected recompute does not re-announce.");
};
exports.reportComputedEscape = __webpack_exports__.reportComputedEscape;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "reportComputedEscape"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
