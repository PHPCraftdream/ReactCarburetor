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
    leafVersionsDrifted: ()=>leafVersionsDrifted
});
const isNativeStoreSource_js_namespaceObject = require("../../Store/Scheduling/isNativeStoreSource.js");
const leafVersionsDrifted = (versions, dependencies)=>{
    for(const cuid in versions){
        if (!Object.prototype.hasOwnProperty.call(versions, cuid)) continue;
        const recorded = versions[cuid];
        if (recorded.source.getVersion() !== recorded.version) {
            var _recorded_source_hasDriftSince, _recorded_source;
            const dependency = Object.prototype.hasOwnProperty.call(dependencies, cuid) ? dependencies[cuid] : void 0;
            const reads = recorded.reads ?? ((null == dependency ? void 0 : dependency.source) === recorded.source ? dependency.reads : void 0);
            if (reads && (0, isNativeStoreSource_js_namespaceObject.isNativeStoreSource)(recorded.source) && (null == (_recorded_source_hasDriftSince = (_recorded_source = recorded.source).hasDriftSince) ? void 0 : _recorded_source_hasDriftSince.call(_recorded_source, recorded.version, reads)) === false) continue;
            return true;
        }
    }
    return false;
};
exports.leafVersionsDrifted = __webpack_exports__.leafVersionsDrifted;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "leafVersionsDrifted"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
