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
const isExotic = (value)=>'object' == typeof value && null !== value && !Array.isArray(value) && !(0, external_isPlainObject_js_namespaceObject.isPlainObject)(value);
const sameKeyedContent = (snapshot, next, previousToFresh, freshToPrevious)=>{
    const previousKeys = Reflect.ownKeys(snapshot);
    const freshKeys = Reflect.ownKeys(next);
    if (previousKeys.length !== freshKeys.length) return false;
    return previousKeys.every((key)=>{
        const previousDescriptor = Object.getOwnPropertyDescriptor(snapshot, key);
        const freshDescriptor = Object.getOwnPropertyDescriptor(next, key);
        if (void 0 === previousDescriptor || void 0 === freshDescriptor) return false;
        if (!Object.prototype.hasOwnProperty.call(previousDescriptor, 'value') || !Object.prototype.hasOwnProperty.call(freshDescriptor, 'value')) throw new Error('sameSelection() cannot compare accessor property ' + String(key) + ': select plain data fields instead.');
        if (previousDescriptor.enumerable !== freshDescriptor.enumerable || previousDescriptor.configurable !== freshDescriptor.configurable || previousDescriptor.writable !== freshDescriptor.writable) return false;
        return sameValue(Reflect.get(snapshot, key), Reflect.get(next, key), previousToFresh, freshToPrevious);
    });
};
const sameValue = (a, b, previousToFresh, freshToPrevious)=>{
    if (isExotic(a) || isExotic(b)) return false;
    if (Object.is(a, b)) return true;
    if ('object' != typeof a || null === a || 'object' != typeof b || null === b) return false;
    const mapped = previousToFresh.get(a);
    if (void 0 !== mapped) return mapped === b;
    if (void 0 !== freshToPrevious.get(b)) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
        previousToFresh.set(a, b);
        freshToPrevious.set(b, a);
        return sameKeyedContent(a, b, previousToFresh, freshToPrevious);
    }
    if (!(0, external_isPlainObject_js_namespaceObject.isPlainObject)(a) || !(0, external_isPlainObject_js_namespaceObject.isPlainObject)(b)) return false;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    previousToFresh.set(a, b);
    freshToPrevious.set(b, a);
    return sameKeyedContent(a, b, previousToFresh, freshToPrevious);
};
const sameSelection = (snapshot, next)=>sameValue(snapshot, next, new WeakMap(), new WeakMap());
exports.sameSelection = __webpack_exports__.sameSelection;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "sameSelection"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
