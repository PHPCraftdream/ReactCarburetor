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
    deepClone: ()=>deepClone
});
const isTrackable_js_namespaceObject = require("../Tracking/isTrackable.js");
const deepClone = (value)=>{
    if (!(0, isTrackable_js_namespaceObject.isTrackable)(value)) return value;
    if (Array.isArray(value)) return value.map((item)=>deepClone(item));
    const source = value;
    const result = {};
    Object.keys(source).forEach((key)=>{
        result[key] = deepClone(source[key]);
    });
    return result;
};
exports.deepClone = __webpack_exports__.deepClone;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "deepClone"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
