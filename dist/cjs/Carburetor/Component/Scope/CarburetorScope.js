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
    CarburetorScope: ()=>CarburetorScope
});
const DiagnosticsInstance_js_namespaceObject = require("../../Store/Diagnostics/DiagnosticsInstance.js");
const DevelopmentFlag_js_namespaceObject = require("../../Store/Utils/DevelopmentFlag.js");
class CarburetorScope {
    instances = new Map();
    get = (token)=>{
        if (this.instances.has(token.id)) return this.instances.get(token.id);
        const created = token.create();
        this.instances.set(token.id, created);
        return created;
    };
    set = (token, instance)=>{
        this.instances.set(token.id, instance);
    };
    has = (token)=>this.instances.has(token.id);
    dehydrate = ()=>{
        const entries = [];
        this.instances.forEach((instance, id)=>{
            if (this.isInspectable(instance)) entries.push([
                id,
                instance.toJSON()
            ]);
        });
        return Object.fromEntries(entries);
    };
    hydrate = (state, tokens)=>{
        const claimed = new Set();
        tokens.forEach((token)=>{
            if (!Object.prototype.hasOwnProperty.call(state, token.id)) return;
            claimed.add(token.id);
            const instance = this.get(token);
            if (this.isInspectable(instance)) instance.fromJSON(state[token.id]);
        });
        if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT) {
            const unclaimed = Object.keys(state).filter((key)=>!claimed.has(key));
            if (unclaimed.length > 0) DiagnosticsInstance_js_namespaceObject.diagnostics.report('hydrate() was handed state under keys no token claims: ' + unclaimed.map((key)=>'"' + key + '"').join(', ') + ". Those entries were ignored; if one of them looks like a token name, the server and the client declare that token under different names.");
        }
    };
    isInspectable = (instance)=>{
        if ('object' != typeof instance || null === instance) return false;
        const candidate = instance;
        return 'function' == typeof candidate.toJSON && 'function' == typeof candidate.fromJSON;
    };
}
exports.CarburetorScope = __webpack_exports__.CarburetorScope;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "CarburetorScope"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
