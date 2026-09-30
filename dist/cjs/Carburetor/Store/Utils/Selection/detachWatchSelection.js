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
    detachWatchSelection: ()=>detachWatchSelection
});
const external_detachOpaque_js_namespaceObject = require("./detachOpaque.js");
const detachWatchSelection = (value)=>{
    if (null === value || 'object' != typeof value) return value;
    return (0, external_detachOpaque_js_namespaceObject.detachOpaque)(value, (instance)=>{
        var _Object_getPrototypeOf_constructor, _Object_getPrototypeOf;
        throw new Error('watch() cannot select a live ' + ((null == (_Object_getPrototypeOf = Object.getPrototypeOf(instance)) ? void 0 : null == (_Object_getPrototypeOf_constructor = _Object_getPrototypeOf.constructor) ? void 0 : _Object_getPrototypeOf_constructor.name) || 'class') + " instance because in-place changes cannot produce a safe comparison. Select the fields the callback needs, or return a plain object of those fields.");
    });
};
exports.detachWatchSelection = __webpack_exports__.detachWatchSelection;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "detachWatchSelection"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
