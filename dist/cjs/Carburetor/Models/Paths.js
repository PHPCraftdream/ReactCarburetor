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
const PATCH_ABSENT = Symbol.for('react-carburetor/v1/patch-absent');
const PATCH_OPAQUE = Symbol.for('react-carburetor/v1/patch-opaque');
__webpack_require__.d(__webpack_exports__, {}, {
    PATCH_ABSENT: PATCH_ABSENT,
    PATCH_OPAQUE: PATCH_OPAQUE
});
exports.PATCH_ABSENT = __webpack_exports__.PATCH_ABSENT;
exports.PATCH_OPAQUE = __webpack_exports__.PATCH_OPAQUE;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "PATCH_ABSENT",
    "PATCH_OPAQUE"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
