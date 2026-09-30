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
    detachSelection: ()=>detachSelection
});
const detachOpaque_js_namespaceObject = require("../../Store/Utils/Selection/detachOpaque.js");
const rejectArraySubclass = (value)=>{
    var _Object_getPrototypeOf;
    const ctor = null == (_Object_getPrototypeOf = Object.getPrototypeOf(value)) ? void 0 : _Object_getPrototypeOf.constructor;
    const name = 'function' == typeof ctor && ctor.name ? ctor.name : 'an anonymous class';
    throw new Error('detachSelection() cannot snapshot an Array subclass (' + name + '): copying it would forge an "instanceof ' + name + '" object whose constructor never ran and whose private fields were never installed. Select a plain array (for example Array.from(value)) or project the fields the child needs instead.');
};
const detachSelection = (value)=>(0, detachOpaque_js_namespaceObject.detachOpaque)(value, void 0, rejectArraySubclass);
exports.detachSelection = __webpack_exports__.detachSelection;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "detachSelection"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
