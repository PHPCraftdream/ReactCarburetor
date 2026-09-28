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
    carburetorToken: ()=>carburetorToken
});
const DiagnosticsInstance_js_namespaceObject = require("../../Store/Diagnostics/DiagnosticsInstance.js");
const DevelopmentFlag_js_namespaceObject = require("../../Store/Utils/DevelopmentFlag.js");
const sharedSingleton_js_namespaceObject = require("../../Store/Utils/sharedSingleton.js");
const takenNames = (0, sharedSingleton_js_namespaceObject.sharedSingleton)('takenNames', ()=>new Set());
const carburetorToken = (create, name)=>{
    if ('' === name) throw new Error('Carburetor: a token needs a non-empty name: it is the key the client hydrates from.');
    if (takenNames.has(name)) {
        if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT) DiagnosticsInstance_js_namespaceObject.diagnostics.report('a token named "' + name + '" already exists. Two tokens under one name would overwrite each other in a scope and in a dehydrate() payload; give one of them its own name — or ignore this if it is an HMR reload of the module that declared it.');
        return {
            id: name,
            create
        };
    }
    takenNames.add(name);
    return {
        id: name,
        create
    };
};
exports.carburetorToken = __webpack_exports__.carburetorToken;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "carburetorToken"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
