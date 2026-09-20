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
    CarburetorContext: ()=>CarburetorContext,
    CarburetorProvider: ()=>CarburetorProvider,
    CarburetorScope: ()=>CarburetorScope,
    ScopedAntiHookComponent: ()=>ScopedAntiHookComponent,
    carburetorToken: ()=>carburetorToken
});
const external_react_namespaceObject = require("react");
const external_AntiHookComponent_js_namespaceObject = require("./AntiHookComponent.js");
const getUid_js_namespaceObject = require("./Utils/getUid.js");
const carburetorToken = (create)=>({
        id: (0, getUid_js_namespaceObject.getUid)(),
        create
    });
class CarburetorScope {
    instances = new Map();
    get = (token)=>{
        const known = this.instances.get(token.id);
        if (void 0 !== known) return known;
        const created = token.create();
        this.instances.set(token.id, created);
        return created;
    };
    set = (token, instance)=>{
        this.instances.set(token.id, instance);
    };
    has = (token)=>this.instances.has(token.id);
}
const CarburetorContext = /*#__PURE__*/ external_react_namespaceObject.createContext(null);
class CarburetorProvider extends external_react_namespaceObject.Component {
    render() {
        return /*#__PURE__*/ external_react_namespaceObject.createElement(CarburetorContext.Provider, {
            value: this.props.scope
        }, this.props.children);
    }
}
class ScopedAntiHookComponent extends external_AntiHookComponent_js_namespaceObject.AntiHookComponent {
    static contextType = CarburetorContext;
    scope() {
        if (!this.context) throw new Error("Carburetor: no scope found. Wrap the tree in <CarburetorProvider scope={...}> before using a scoped component.");
        return this.context;
    }
    resolve(token) {
        return this.scope().get(token);
    }
}
exports.CarburetorContext = __webpack_exports__.CarburetorContext;
exports.CarburetorProvider = __webpack_exports__.CarburetorProvider;
exports.CarburetorScope = __webpack_exports__.CarburetorScope;
exports.ScopedAntiHookComponent = __webpack_exports__.ScopedAntiHookComponent;
exports.carburetorToken = __webpack_exports__.carburetorToken;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "CarburetorContext",
    "CarburetorProvider",
    "CarburetorScope",
    "ScopedAntiHookComponent",
    "carburetorToken"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
