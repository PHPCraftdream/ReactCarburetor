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
    buildPersistentView: ()=>buildPersistentView
});
const external_ConnectionFacadeHandler_js_namespaceObject = require("./ConnectionFacadeHandler.js");
const liveViews_js_namespaceObject = require("../../Store/Tracking/liveViews.js");
const WildcardPath_js_namespaceObject = require("../../Store/Paths/WildcardPath.js");
const SHARED_OBJECT_TARGET = {};
const SHARED_ARRAY_TARGET = [];
const buildPersistentView = (source)=>{
    try {
        source.arrayFacade = Array.isArray(source.getCarburetor().getData());
    } catch (error) {
        source.probeError = error;
    }
    const facade = new Proxy(source.arrayFacade ? SHARED_ARRAY_TARGET : SHARED_OBJECT_TARGET, new external_ConnectionFacadeHandler_js_namespaceObject.ConnectionFacadeHandler(source));
    liveViews_js_namespaceObject.liveViews.noteDynamicReadTarget(facade, ()=>{
        const data = source.resolveAttemptSource().getData();
        const prototype = Object.getPrototypeOf(data);
        if (prototype === Array.prototype || prototype === Object.prototype || null === prototype) return data;
        if (data instanceof Map && prototype === Map.prototype || data instanceof Set && prototype === Set.prototype || data instanceof Date && prototype === Date.prototype) {
            source.recorder(WildcardPath_js_namespaceObject.WILDCARD_PATH);
            return data;
        }
    });
    return facade;
};
exports.buildPersistentView = __webpack_exports__.buildPersistentView;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "buildPersistentView"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
