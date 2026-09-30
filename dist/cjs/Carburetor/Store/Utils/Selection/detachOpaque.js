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
    detachOpaque: ()=>detachOpaque
});
const isTrackable_js_namespaceObject = require("../../Tracking/isTrackable.js");
const liveViews_js_namespaceObject = require("../../Tracking/liveViews.js");
const detachedDescriptor = (source, key, seen, onLiveInstance, onArraySubclass, descriptorSource = source)=>{
    const descriptor = Object.getOwnPropertyDescriptor(descriptorSource, key);
    if (!descriptor) return;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error((void 0 === onArraySubclass ? 'detachOpaque()' : 'detachSelection()') + ' cannot snapshot accessor property ' + String(key) + ': select plain data fields instead.');
    descriptor.value = detach(Reflect.get(source, key), seen, onLiveInstance, onArraySubclass);
    return descriptor;
};
const copyNativeFields = (source, copy, seen, onLiveInstance, onArraySubclass)=>{
    const keys = Reflect.ownKeys(source);
    for(let index = 0; index < keys.length; index++){
        const key = keys[index];
        const descriptor = detachedDescriptor(source, key, seen, onLiveInstance, onArraySubclass);
        if (descriptor) Object.defineProperty(copy, key, descriptor);
    }
};
const detach = (value, seen, onLiveInstance, onArraySubclass)=>{
    if (null === value || 'object' != typeof value) return value;
    const target = liveViews_js_namespaceObject.liveViews.readTarget(value);
    const known = seen.get(target ?? value);
    if (void 0 !== known) {
        if (void 0 !== target && !seen.has(value)) {
            seen.set(value, known);
            Reflect.ownKeys(value).forEach((key)=>{
                if (!Array.isArray(value) || 'length' !== key) detachedDescriptor(value, key, seen, onLiveInstance, onArraySubclass, target);
            });
        }
        return known;
    }
    const native = target ?? value;
    if (native instanceof Date && Object.getPrototypeOf(native) === Date.prototype) {
        const copy = new Date(Date.prototype.getTime.call(native));
        seen.set(value, copy);
        if (void 0 !== target) seen.set(target, copy);
        copyNativeFields(native, copy, seen, onLiveInstance, onArraySubclass);
        return copy;
    }
    if (native instanceof Map && Object.getPrototypeOf(native) === Map.prototype) {
        const copy = new Map();
        seen.set(value, copy);
        if (void 0 !== target) seen.set(target, copy);
        Map.prototype.forEach.call(native, (member, key)=>{
            copy.set(detach(key, seen, onLiveInstance, onArraySubclass), detach(member, seen, onLiveInstance, onArraySubclass));
        });
        copyNativeFields(native, copy, seen, onLiveInstance, onArraySubclass);
        return copy;
    }
    if (native instanceof Set && Object.getPrototypeOf(native) === Set.prototype) {
        const copy = new Set();
        seen.set(value, copy);
        if (void 0 !== target) seen.set(target, copy);
        Set.prototype.forEach.call(native, (member)=>{
            copy.add(detach(member, seen, onLiveInstance, onArraySubclass));
        });
        copyNativeFields(native, copy, seen, onLiveInstance, onArraySubclass);
        return copy;
    }
    if (Array.isArray(value)) {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Array.prototype && prototype !== Object.prototype && null !== prototype) {
            if (void 0 !== onArraySubclass) onArraySubclass(value);
            null == onLiveInstance || onLiveInstance(value);
            return value;
        }
        const copy = prototype === Array.prototype ? [] : Object.setPrototypeOf([], prototype);
        seen.set(value, copy);
        if (void 0 !== target) seen.set(target, copy);
        Reflect.ownKeys(value).forEach((key)=>{
            if ('length' !== key) {
                const descriptor = detachedDescriptor(value, key, seen, onLiveInstance, onArraySubclass, target);
                if (descriptor) Object.defineProperty(copy, key, descriptor);
            }
        });
        const length = Object.getOwnPropertyDescriptor(value, 'length');
        if (length) Object.defineProperty(copy, 'length', length);
        return copy;
    }
    if (!(0, isTrackable_js_namespaceObject.isTrackable)(value)) {
        null == onLiveInstance || onLiveInstance(value);
        return value;
    }
    const source = value;
    const result = Object.create(Object.getPrototypeOf(source));
    seen.set(value, result);
    if (void 0 !== target) seen.set(target, result);
    Reflect.ownKeys(source).forEach((key)=>{
        const descriptor = detachedDescriptor(source, key, seen, onLiveInstance, onArraySubclass, target);
        if (descriptor) Object.defineProperty(result, key, descriptor);
    });
    return result;
};
const detachOpaque = (value, onLiveInstance, onArraySubclass)=>detach(value, new WeakMap(), onLiveInstance, onArraySubclass);
exports.detachOpaque = __webpack_exports__.detachOpaque;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "detachOpaque"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
