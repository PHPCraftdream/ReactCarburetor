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
    installPatch: ()=>installPatch
});
const Paths_js_namespaceObject = require("../../../Models/Paths.js");
const isTrackable_js_namespaceObject = require("../../Tracking/isTrackable.js");
const deepClone_js_namespaceObject = require("../../Utils/deepClone.js");
const installPatch = (root, patch, inverse)=>{
    let node = root;
    for(let i = 0; i < patch.segments.length - 1; i++)node = node[patch.segments[i]];
    const key = patch.segments[patch.segments.length - 1];
    const value = inverse ? patch.previous : patch.next;
    if (value === Paths_js_namespaceObject.PATCH_ABSENT) delete node[key];
    else node[key] = (0, isTrackable_js_namespaceObject.isTrackable)(value) ? (0, deepClone_js_namespaceObject.deepClone)(value) : value;
};
exports.installPatch = __webpack_exports__.installPatch;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "installPatch"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
