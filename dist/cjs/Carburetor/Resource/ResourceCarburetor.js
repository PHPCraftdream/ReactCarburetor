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
    ResourceCarburetor: ()=>ResourceCarburetor
});
const EResourceStatus_js_namespaceObject = require("../Models/Enums/EResourceStatus.js");
const Carburetor_js_namespaceObject = require("../Store/Carburetor.js");
const deepClone_js_namespaceObject = require("../Store/Utils/deepClone.js");
const external_getInitialResourceData_js_namespaceObject = require("./getInitialResourceData.js");
const external_createAbortHandle_js_namespaceObject = require("./createAbortHandle.js");
const describeError = (error)=>{
    if (error instanceof Error) return error.message;
    return String(error);
};
class ResourceCarburetor extends Carburetor_js_namespaceObject.Carburetor {
    loader;
    controller = void 0;
    pendingKey = void 0;
    pendingRequest = void 0;
    settledKey = void 0;
    lastArgs = void 0;
    lastKey = void 0;
    lastError = void 0;
    constructor(loader, scheduler){
        super((0, external_getInitialResourceData_js_namespaceObject.getInitialResourceData)(), scheduler), this.loader = loader;
    }
    snapshot = ()=>({
            ...(0, deepClone_js_namespaceObject.deepClone)(this.data),
            key: this.settledKey
        });
    restore = (data)=>{
        this.cancelInFlight();
        const settled = data.status === EResourceStatus_js_namespaceObject.EResourceStatus.Success || data.status === EResourceStatus_js_namespaceObject.EResourceStatus.Error;
        this.settledKey = settled ? data.key : void 0;
        this.lastError = data.status === EResourceStatus_js_namespaceObject.EResourceStatus.Error && data.error ? new Error(data.error) : void 0;
        const status = data.status === EResourceStatus_js_namespaceObject.EResourceStatus.Pending ? EResourceStatus_js_namespaceObject.EResourceStatus.Idle : data.status;
        this.setData((0, deepClone_js_namespaceObject.deepClone)({
            status,
            data: data.data,
            error: data.error,
            updatedAt: data.updatedAt
        }));
    };
    getLastError = ()=>this.lastError;
    suspend = (args)=>{
        const state = this.data;
        const key = this.keyOf(args);
        if (state.status === EResourceStatus_js_namespaceObject.EResourceStatus.Success && this.settledKey === key) return state.data;
        if (state.status === EResourceStatus_js_namespaceObject.EResourceStatus.Error && this.settledKey === key) throw this.lastError || new Error(state.error || 'Carburetor: resource failed');
        if (this.pendingRequest && this.pendingKey === key) throw this.pendingRequest;
        throw this.start(args, true);
    };
    load = (args)=>this.start(args, false);
    reload = ()=>{
        if (void 0 === this.lastKey) return Promise.resolve();
        const args = this.lastArgs;
        this.pendingKey = void 0;
        this.pendingRequest = void 0;
        return this.start(args, false);
    };
    abort = ()=>{
        if (!this.controller) return;
        this.cancelInFlight();
        this.draft.status = EResourceStatus_js_namespaceObject.EResourceStatus.Idle;
        this.emitUpdate();
    };
    cancelInFlight = ()=>{
        if (!this.controller) return;
        this.controller.abort();
        this.controller = void 0;
        this.pendingRequest = void 0;
        this.pendingKey = void 0;
    };
    start = (args, deferNotification)=>{
        const key = this.keyOf(args);
        if (this.pendingRequest && this.pendingKey === key) return this.pendingRequest;
        this.cancelInFlight();
        const controller = (0, external_createAbortHandle_js_namespaceObject.createAbortHandle)();
        this.controller = controller;
        this.pendingKey = key;
        this.lastArgs = args;
        this.lastKey = key;
        this.settledKey = void 0;
        this.draft.status = EResourceStatus_js_namespaceObject.EResourceStatus.Pending;
        this.draft.error = void 0;
        if (deferNotification) this.emitSoon();
        else this.emitUpdate();
        let answer;
        try {
            answer = this.loader(args, controller.signal);
        } catch (error) {
            answer = Promise.reject(error);
        }
        this.pendingRequest = answer.then((data)=>{
            this.settleSuccess(controller, key, data);
        }, (error)=>{
            this.settleError(controller, key, error);
        });
        return this.pendingRequest;
    };
    keyOf = (args)=>JSON.stringify(void 0 === args ? null : args);
    isCurrent = (controller)=>this.controller === controller && !controller.signal.aborted;
    settleSuccess = (controller, key, data)=>{
        if (!this.isCurrent(controller)) return;
        this.controller = void 0;
        this.pendingRequest = void 0;
        this.settledKey = key;
        this.lastError = void 0;
        this.draft.status = EResourceStatus_js_namespaceObject.EResourceStatus.Success;
        this.draft.data = data;
        this.draft.error = void 0;
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };
    settleError = (controller, key, error)=>{
        if (!this.isCurrent(controller)) return;
        this.controller = void 0;
        this.pendingRequest = void 0;
        this.settledKey = key;
        this.lastError = error;
        this.draft.status = EResourceStatus_js_namespaceObject.EResourceStatus.Error;
        this.draft.error = describeError(error);
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };
}
exports.ResourceCarburetor = __webpack_exports__.ResourceCarburetor;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "ResourceCarburetor"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
