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
    ScopedAntiHookComponent: ()=>ScopedAntiHookComponent
});
const AntiHookComponent_js_namespaceObject = require("./AntiHookComponent/AntiHookComponent.js");
const CarburetorContext_js_namespaceObject = require("./Scope/CarburetorContext.js");
class ScopedAntiHookComponent extends AntiHookComponent_js_namespaceObject.AntiHookComponent {
    static contextType = CarburetorContext_js_namespaceObject.CarburetorContext;
    scope() {
        if (!this.context) throw new Error("Carburetor: no scope found. Wrap the tree in <CarburetorProvider scope={...}> before using a scoped component.");
        return this.context;
    }
    resolve(token) {
        return this.scope().get(token);
    }
}
exports.ScopedAntiHookComponent = __webpack_exports__.ScopedAntiHookComponent;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "ScopedAntiHookComponent"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
