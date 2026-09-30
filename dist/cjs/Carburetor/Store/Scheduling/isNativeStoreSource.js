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
    isNativeStoreSource: ()=>isNativeStoreSource
});
const external_nativeStoreWriteEpoch_js_namespaceObject = require("./nativeStoreWriteEpoch.js");
const isNativeStoreSource = (source)=>{
    const methods = external_nativeStoreWriteEpoch_js_namespaceObject.nativeStoreWriteEpoch.sources.get(source);
    return void 0 !== methods && source.getVersion === methods.getVersion && source.emitUpdate === methods.emitUpdate;
};
exports.isNativeStoreSource = __webpack_exports__.isNativeStoreSource;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "isNativeStoreSource"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
