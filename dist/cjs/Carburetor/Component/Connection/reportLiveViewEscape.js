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
const external_ownEnumerableKeys_js_namespaceObject = require("./ownEnumerableKeys.js");
const describeSegment = (segment)=>'symbol' == typeof segment ? '[' + segment.toString() + ']' : segment;
const findLiveView = (value, visited, path)=>{
    if (liveViews_js_namespaceObject.liveViews.has(value)) return path;
    if ('object' != typeof value || null === value) return;
    if (!Array.isArray(value) && !(0, external_isPlainObject_js_namespaceObject.isPlainObject)(value)) return;
    if (visited.has(value)) return;
    visited.add(value);
    const members = value;
    for (const key of (0, external_ownEnumerableKeys_js_namespaceObject.ownEnumerableKeys)(value)){
        const found = findLiveView(members[key], visited, [
            ...path,
            key
        ]);
        if (void 0 !== found) return found;
    }
};
const reportLiveViewEscape = (next)=>{
    const location = findLiveView(next, new Set(), []);
    if (void 0 === location) return false;
    const where = 0 === location.length ? 'as its whole value' : 'at "' + location.map(describeSegment).join('.') + '"';
    DiagnosticsInstance_js_namespaceObject.diagnostics.report('a connectSelection() snapshot handed a child a live store view ' + where + ". A child reading it in its own render records nothing, so no subscription covers what it sees and it never hears about changes. Select plain values — primitives, or plain objects and arrays built from them.");
    return true;
};
exports.reportLiveViewEscape = __webpack_exports__.reportLiveViewEscape;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "reportLiveViewEscape"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
