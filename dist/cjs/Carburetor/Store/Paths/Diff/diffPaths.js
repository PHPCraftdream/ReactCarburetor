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
    diffPaths: ()=>diffPaths
});
const Paths_js_namespaceObject = require("../../../Models/Paths.js");
const external_joinPath_js_namespaceObject = require("../joinPath.js");
const KeysMarker_js_namespaceObject = require("../Markers/KeysMarker.js");
const external_WildcardPath_js_namespaceObject = require("../WildcardPath.js");
const isTrackable_js_namespaceObject = require("../../Tracking/isTrackable.js");
const deepClone_js_namespaceObject = require("../../Utils/deepClone.js");
const external_DiffThreshold_js_namespaceObject = require("./DiffThreshold.js");
const external_sameKind_js_namespaceObject = require("./sameKind.js");
class DiffOverflow extends Error {
}
const patchValue = (value)=>(0, isTrackable_js_namespaceObject.isTrackable)(value) ? (0, deepClone_js_namespaceObject.deepClone)(value) : value;
const add = (into, path)=>{
    into.add(path);
    if (into.size > external_DiffThreshold_js_namespaceObject.DIFF_PATH_THRESHOLD) throw new DiffOverflow();
};
const addPatch = (onPatch, segments, previous, next)=>{
    null == onPatch || onPatch({
        segments,
        previous: patchValue(previous),
        next: patchValue(next)
    });
};
const walkContainer = (oldValue, newValue, path, segments, into, onPatch)=>{
    if (Array.isArray(oldValue) && oldValue.length !== newValue.length) {
        add(into, (0, external_joinPath_js_namespaceObject.joinPath)(path, 'length'));
        addPatch(onPatch, [
            ...segments,
            'length'
        ], oldValue.length, newValue.length);
    }
    const oldKeys = Object.keys(oldValue);
    const newKeys = Object.keys(newValue);
    const seen = new Set();
    let keysChanged = false;
    for (const key of oldKeys){
        seen.add(key);
        if (!Object.prototype.hasOwnProperty.call(newValue, key)) {
            keysChanged = true;
            add(into, (0, external_joinPath_js_namespaceObject.joinPath)(path, key));
            addPatch(onPatch, [
                ...segments,
                key
            ], oldValue[key], Paths_js_namespaceObject.PATCH_ABSENT);
            continue;
        }
        walk(oldValue[key], newValue[key], (0, external_joinPath_js_namespaceObject.joinPath)(path, key), [
            ...segments,
            key
        ], into, onPatch);
    }
    for (const key of newKeys)if (!seen.has(key)) {
        keysChanged = true;
        add(into, (0, external_joinPath_js_namespaceObject.joinPath)(path, key));
        addPatch(onPatch, [
            ...segments,
            key
        ], Paths_js_namespaceObject.PATCH_ABSENT, newValue[key]);
    }
    if (keysChanged) add(into, (0, KeysMarker_js_namespaceObject.keysPath)(path));
};
const walk = (oldValue, newValue, path, segments, into, onPatch)=>{
    if (Object.is(oldValue, newValue)) return;
    if (!(0, isTrackable_js_namespaceObject.isTrackable)(oldValue) || !(0, isTrackable_js_namespaceObject.isTrackable)(newValue)) {
        add(into, path || external_WildcardPath_js_namespaceObject.WILDCARD_PATH);
        addPatch(onPatch, segments, oldValue, newValue);
        return;
    }
    if (!(0, external_sameKind_js_namespaceObject.sameKind)(oldValue, newValue)) {
        add(into, path || external_WildcardPath_js_namespaceObject.WILDCARD_PATH);
        addPatch(onPatch, segments, oldValue, newValue);
        return;
    }
    walkContainer(oldValue, newValue, path, segments, into, onPatch);
};
const diffPaths = (oldValue, newValue, basePath = '', baseSegments = [], onPatch)=>{
    const changed = new Set();
    try {
        walk(oldValue, newValue, basePath, baseSegments, changed, onPatch);
    } catch (error) {
        if (!(error instanceof DiffOverflow)) throw error;
        changed.clear();
        changed.add(basePath || external_WildcardPath_js_namespaceObject.WILDCARD_PATH);
        addPatch(onPatch, baseSegments, oldValue, newValue);
    }
    return changed;
};
exports.diffPaths = __webpack_exports__.diffPaths;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "diffPaths"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
