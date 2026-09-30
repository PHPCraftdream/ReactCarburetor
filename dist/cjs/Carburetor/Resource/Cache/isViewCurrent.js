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
const isViewCurrent = (view, entry, stale)=>view.stale === stale && view.status === entry.status && Object.is(view.data, entry.data) && view.error === entry.error && view.updatedAt === entry.updatedAt && view.refreshing === entry.refreshing && view.invalidated === entry.invalidated && view.failed === entry.failed;
__webpack_require__.d(__webpack_exports__, {}, {
    isViewCurrent: isViewCurrent
});
exports.isViewCurrent = __webpack_exports__.isViewCurrent;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "isViewCurrent"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
