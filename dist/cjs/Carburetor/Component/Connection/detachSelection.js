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
const external_isPlainObject_js_namespaceObject = require("./isPlainObject.js");
const detachedDescriptor = (source, key, seen)=>{
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (void 0 === descriptor) return;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('detachSelection() cannot snapshot accessor property ' + String(key) + ': select plain data fields instead.');
    descriptor.value = detachDeep(Reflect.get(source, key), seen);
    return descriptor;
};
const detachDeep = (value, seen)=>{
    if ('object' != typeof value || null === value) return value;
    if (seen.has(value)) return seen.get(value);
    const isArray = Array.isArray(value);
    if (!isArray && !(0, external_isPlainObject_js_namespaceObject.isPlainObject)(value)) return value;
    const target = isArray ? Object.setPrototypeOf([], Object.getPrototypeOf(value)) : Object.create(Object.getPrototypeOf(value));
    seen.set(value, target);
    const source = value;
    Reflect.ownKeys(value).forEach((key)=>{
        if (isArray && 'length' === key) return;
        const descriptor = detachedDescriptor(source, key, seen);
        if (void 0 !== descriptor) Object.defineProperty(target, key, descriptor);
    });
    if (isArray) {
        const length = Object.getOwnPropertyDescriptor(value, 'length');
        if (void 0 !== length) Object.defineProperty(target, 'length', length);
    }
    return target;
};
const detachSelection = (value)=>detachDeep(value, new WeakMap());
exports.detachSelection = __webpack_exports__.detachSelection;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "detachSelection"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
