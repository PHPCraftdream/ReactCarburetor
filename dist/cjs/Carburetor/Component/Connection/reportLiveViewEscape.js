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
    reportLiveViewEscape: ()=>reportLiveViewEscape
});
const DiagnosticsInstance_js_namespaceObject = require("../../Store/Diagnostics/DiagnosticsInstance.js");
const liveViews_js_namespaceObject = require("../../Store/Tracking/liveViews.js");
const external_isPlainObject_js_namespaceObject = require("./isPlainObject.js");
const reportLiveViewEscape = (next)=>{
    const guidance = "A child reading it in its own render records nothing, so no subscription covers what it sees and it never hears about changes. Select plain values — primitives, or plain objects and arrays built from them.";
    if (liveViews_js_namespaceObject.liveViews.has(next)) {
        DiagnosticsInstance_js_namespaceObject.diagnostics.report('a connectSelection() snapshot handed a child a live store view as its whole value. ' + guidance);
        return true;
    }
    if (Array.isArray(next)) {
        const index = next.findIndex((member)=>liveViews_js_namespaceObject.liveViews.has(member));
        if (-1 !== index) {
            DiagnosticsInstance_js_namespaceObject.diagnostics.report('a connectSelection() snapshot handed a child a live store view as array member ' + index + '. ' + guidance);
            return true;
        }
        return false;
    }
    if ((0, external_isPlainObject_js_namespaceObject.isPlainObject)(next)) {
        const members = next;
        const key = Object.keys(members).find((memberKey)=>liveViews_js_namespaceObject.liveViews.has(members[memberKey]));
        if (void 0 !== key) {
            DiagnosticsInstance_js_namespaceObject.diagnostics.report('a connectSelection() snapshot handed a child a live store view as member "' + key + '". ' + guidance);
            return true;
        }
    }
    return false;
};
exports.reportLiveViewEscape = __webpack_exports__.reportLiveViewEscape;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "reportLiveViewEscape"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
