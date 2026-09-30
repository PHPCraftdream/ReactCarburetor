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
    captureLeafVersions: ()=>captureLeafVersions
});
const isNativeStoreSource_js_namespaceObject = require("../../Store/Scheduling/isNativeStoreSource.js");
const external_computedDependencies_js_namespaceObject = require("../computedDependencies.js");
const addLeafVersion = (versions, id, recorded)=>{
    const previous = versions[id];
    if ((null == previous ? void 0 : previous.source) === recorded.source && previous.reads && recorded.reads && previous.reads !== recorded.reads) {
        const combined = new Set(previous.reads);
        for (const path of recorded.reads)combined.add(path);
        versions[id] = {
            source: recorded.source,
            version: recorded.version,
            reads: combined
        };
    } else versions[id] = recorded;
};
const captureLeafVersions = (dependencies, versions)=>{
    let allNative = true;
    for (const cuid of Object.keys(dependencies)){
        var _computedDependencies_versions_get;
        const dependency = dependencies[cuid];
        const inner = 'read' in dependency.source ? void 0 : null == (_computedDependencies_versions_get = external_computedDependencies_js_namespaceObject.computedDependencies.versions.get(dependency.source)) ? void 0 : _computedDependencies_versions_get();
        if (!inner) {
            addLeafVersion(versions, cuid, {
                source: dependency.source,
                version: dependency.source.getVersion(),
                reads: dependency.reads
            });
            if (!(0, isNativeStoreSource_js_namespaceObject.isNativeStoreSource)(dependency.source)) allNative = false;
            continue;
        }
        for (const key of Object.keys(inner)){
            const recorded = inner[key];
            addLeafVersion(versions, ':' + recorded.source.getUID(), recorded);
            if (!(0, isNativeStoreSource_js_namespaceObject.isNativeStoreSource)(recorded.source)) allNative = false;
        }
    }
    return allNative;
};
exports.captureLeafVersions = __webpack_exports__.captureLeafVersions;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "captureLeafVersions"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
