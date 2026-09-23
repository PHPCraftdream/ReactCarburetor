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
    sameSelection: ()=>sameSelection
});
const external_isPlainObject_js_namespaceObject = require("./isPlainObject.js");
const external_ownEnumerableKeys_js_namespaceObject = require("./ownEnumerableKeys.js");
const sameSelection = (snapshot, next)=>{
    if (Object.is(snapshot, next)) return true;
    const snapshotIsArray = Array.isArray(snapshot);
    const nextIsArray = Array.isArray(next);
    if (snapshotIsArray || nextIsArray) {
        if (!snapshotIsArray || !nextIsArray) return false;
        const previousMembers = snapshot;
        const freshMembers = next;
        return previousMembers.length === freshMembers.length && previousMembers.every((member, index)=>Object.is(member, freshMembers[index]));
    }
    if (!(0, external_isPlainObject_js_namespaceObject.isPlainObject)(snapshot) || !(0, external_isPlainObject_js_namespaceObject.isPlainObject)(next)) return false;
    const previousKeys = (0, external_ownEnumerableKeys_js_namespaceObject.ownEnumerableKeys)(snapshot);
    const freshKeys = (0, external_ownEnumerableKeys_js_namespaceObject.ownEnumerableKeys)(next);
    if (previousKeys.length !== freshKeys.length) return false;
    const previousMembers = snapshot;
    const freshMembers = next;
    return previousKeys.every((key)=>Object.prototype.hasOwnProperty.call(freshMembers, key) && Object.is(previousMembers[key], freshMembers[key]));
};
exports.sameSelection = __webpack_exports__.sameSelection;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "sameSelection"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
