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
    announceIsUnchanged: ()=>announceIsUnchanged
});
const containsExoticValue_js_namespaceObject = require("../../Store/Utils/containsExoticValue.js");
const announceIsUnchanged = (announced, previous, next, dependenciesMoved, equals)=>{
    const baseline = void 0 !== announced ? announced.value : previous;
    const sameReference = Object.is(baseline, next);
    const opaqueChanged = sameReference && dependenciesMoved && (0, containsExoticValue_js_namespaceObject.containsExoticValue)(next);
    const contentSame = !sameReference && void 0 !== announced && void 0 !== equals && equals(announced.value, next);
    return sameReference && !opaqueChanged || contentSame;
};
exports.announceIsUnchanged = __webpack_exports__.announceIsUnchanged;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "announceIsUnchanged"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
