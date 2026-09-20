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
    ResourceCarburetor: ()=>ResourceCarburetor,
    getInitialResourceData: ()=>getInitialResourceData
});
const external_Carburetor_js_namespaceObject = require("./Carburetor.js");
const getInitialResourceData = ()=>({
        status: 'idle',
        data: void 0,
        error: void 0,
        updatedAt: void 0
    });
const describeError = (error)=>{
    if (error instanceof Error) return error.message;
    return String(error);
};
class ResourceCarburetor extends external_Carburetor_js_namespaceObject.Carburetor {
    loader;
    controller = void 0;
    pendingKey = void 0;
    pendingRequest = void 0;
    lastArgs = void 0;
    lastError = void 0;
    constructor(loader, scheduler){
        super(getInitialResourceData(), scheduler), this.loader = loader;
    }
    getLastError = ()=>this.lastError;
    suspend = (args)=>{
        const state = this.data;
        if ('success' === state.status) return state.data;
        if ('error' === state.status) throw this.lastError || new Error(state.error || 'Carburetor: resource failed');
        if (this.pendingRequest && this.pendingKey === this.keyOf(args)) throw this.pendingRequest;
        throw this.load(args, true);
    };
    load = (args, deferNotification = false)=>{
        const key = this.keyOf(args);
        if (this.pendingRequest && this.pendingKey === key) return this.pendingRequest;
        this.abort();
        const controller = new AbortController();
        this.controller = controller;
        this.pendingKey = key;
        this.lastArgs = args;
        this.draft.status = 'pending';
        this.draft.error = void 0;
        if (deferNotification) queueMicrotask(this.emitUpdate);
        else this.emitUpdate();
        this.pendingRequest = this.loader(args, controller.signal).then((data)=>{
            this.settleSuccess(controller, data);
        }, (error)=>{
            this.settleError(controller, error);
        });
        return this.pendingRequest;
    };
    reload = ()=>{
        if (void 0 === this.pendingKey) return Promise.resolve();
        const args = this.lastArgs;
        this.pendingKey = void 0;
        this.pendingRequest = void 0;
        return this.load(args);
    };
    abort = ()=>{
        if (!this.controller) return;
        this.controller.abort();
        this.controller = void 0;
        this.pendingRequest = void 0;
        this.pendingKey = void 0;
    };
    keyOf = (args)=>JSON.stringify(void 0 === args ? null : args);
    isCurrent = (controller)=>this.controller === controller && !controller.signal.aborted;
    settleSuccess = (controller, data)=>{
        if (!this.isCurrent(controller)) return;
        this.controller = void 0;
        this.pendingRequest = void 0;
        this.lastError = void 0;
        this.draft.status = 'success';
        this.draft.data = data;
        this.draft.error = void 0;
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };
    settleError = (controller, error)=>{
        if (!this.isCurrent(controller)) return;
        this.controller = void 0;
        this.pendingRequest = void 0;
        this.lastError = error;
        this.draft.status = 'error';
        this.draft.error = describeError(error);
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };
}
exports.ResourceCarburetor = __webpack_exports__.ResourceCarburetor;
exports.getInitialResourceData = __webpack_exports__.getInitialResourceData;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "ResourceCarburetor",
    "getInitialResourceData"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
