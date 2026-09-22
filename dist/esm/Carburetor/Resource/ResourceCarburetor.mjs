import { EResourceStatus } from "../Models/Enums/EResourceStatus.mjs";
import { Carburetor } from "../Store/Carburetor.mjs";
import { getInitialResourceData } from "./getInitialResourceData.mjs";
const describeError = (error)=>{
    if (error instanceof Error) return error.message;
    return String(error);
};
class ResourceCarburetor extends Carburetor {
    loader;
    controller = void 0;
    pendingKey = void 0;
    pendingRequest = void 0;
    settledKey = void 0;
    lastArgs = void 0;
    lastError = void 0;
    constructor(loader, scheduler){
        super(getInitialResourceData(), scheduler), this.loader = loader;
    }
    getLastError = ()=>this.lastError;
    suspend = (args)=>{
        const state = this.data;
        const key = this.keyOf(args);
        if (state.status === EResourceStatus.Success && this.settledKey === key) return state.data;
        if (state.status === EResourceStatus.Error && this.settledKey === key) throw this.lastError || new Error(state.error || 'Carburetor: resource failed');
        if (this.pendingRequest && this.pendingKey === key) throw this.pendingRequest;
        throw this.start(args, true);
    };
    load = (args)=>this.start(args, false);
    reload = ()=>{
        if (void 0 === this.pendingKey) return Promise.resolve();
        const args = this.lastArgs;
        this.pendingKey = void 0;
        this.pendingRequest = void 0;
        return this.start(args, false);
    };
    abort = ()=>{
        if (!this.controller) return;
        this.cancelInFlight();
        this.draft.status = EResourceStatus.Idle;
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
        const controller = new AbortController();
        this.controller = controller;
        this.pendingKey = key;
        this.lastArgs = args;
        this.settledKey = void 0;
        this.draft.status = EResourceStatus.Pending;
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
        this.draft.status = EResourceStatus.Success;
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
        this.draft.status = EResourceStatus.Error;
        this.draft.error = describeError(error);
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    };
}
export { ResourceCarburetor };
