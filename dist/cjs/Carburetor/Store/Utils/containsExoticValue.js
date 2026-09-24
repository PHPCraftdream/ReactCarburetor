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
    containsExoticValue: ()=>containsExoticValue
});
const external_isExoticValue_js_namespaceObject = require("./isExoticValue.js");
const containsExoticValue = (value)=>{
    if (null === value || 'object' != typeof value) return false;
    const visited = new WeakSet();
    const walk = (candidate)=>{
        try {
            if ((0, external_isExoticValue_js_namespaceObject.isExoticValue)(candidate)) return true;
            if (null === candidate || 'object' != typeof candidate || visited.has(candidate)) return false;
            visited.add(candidate);
            return Reflect.ownKeys(candidate).some((key)=>{
                const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
                if (!(null == descriptor ? void 0 : descriptor.enumerable)) return false;
                if (!("value" in descriptor)) return true;
                return walk(descriptor.value);
            });
        } catch  {
            return true;
        }
    };
    return walk(value);
};
exports.containsExoticValue = __webpack_exports__.containsExoticValue;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "containsExoticValue"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
