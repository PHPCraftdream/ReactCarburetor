import { EResourceStatus } from "../Models/Enums/EResourceStatus.mjs";
import { Carburetor } from "../Store/Carburetor.mjs";
import { deepClone } from "../Store/Utils/deepClone.mjs";
import { getInitialResourceData } from "./getInitialResourceData.mjs";
import { createAbortHandle } from "./createAbortHandle.mjs";
const describeError = (error)=>{
    if (error instanceof Error) return error.message;
    return String(error);
};
const createSupersededError = ()=>{
    const error = new Error('Resource request was superseded before it started');
    error.name = 'AbortError';
    return error;
};
class ResourceCarburetor extends Carburetor {
    loader;
    controller = void 0;
    pendingKey = void 0;
    pendingRequest = void 0;
    settledKey = void 0;
    lastArgs = void 0;
    lastKey = void 0;
    lastError = void 0;
    hasLastError = false;
    operationVersion = 0;
    lastErrorMessage = void 0;
    errorOwner = void 0;
    constructor(loader, scheduler){
        super(getInitialResourceData(), scheduler), this.loader = loader;
    }
    attachPatchListener(observer) {
        this.patchPort.opaque = true;
        return super.attachPatchListener(observer);
    }
    setData(data) {
        if (data !== this.data && void 0 !== this.settledKey) {
            this.markAllChanged();
            this.settledKey = void 0;
        }
        return super.setData(data);
    }
    snapshot() {
        return {
            ...super.snapshot(),
            key: this.settledKey
        };
    }
    serialize() {
        return JSON.stringify({
            ...this.getData(),
            key: this.settledKey
        });
    }
    restore(data) {
        var _this_patchObservers;
        const operationVersion = ++this.operationVersion;
        this.cancelInFlight();
        if (this.operationVersion !== operationVersion) return;
        null == (_this_patchObservers = this.patchObservers) || _this_patchObservers.ownRestore(data);
        const settled = data.status === EResourceStatus.Success || data.status === EResourceStatus.Error;
        const nextKey = settled ? data.key : void 0;
        if (this.settledKey !== nextKey) this.markAllChanged();
        this.settledKey = nextKey;
        const status = data.status === EResourceStatus.Pending ? EResourceStatus.Idle : data.status;
        super.setData(deepClone({
            status,
            data: data.data,
            error: data.error,
            updatedAt: data.updatedAt
        }));
    }
    fromJSON(value) {
        this.restore(value);
    }
    didSetData() {
        this.reconcileError();
    }
    preEmit() {
        this.reconcileError();
    }
    reconcileError() {
        const state = this.data;
        if (state.status === EResourceStatus.Error) {
            if (!this.hasLastError || this.errorOwner !== state || this.lastErrorMessage !== state.error) {
                this.lastError = new Error(state.error || '');
                this.lastErrorMessage = state.error;
                this.errorOwner = state;
                this.hasLastError = true;
            }
        } else {
            this.lastError = void 0;
            this.lastErrorMessage = void 0;
            this.errorOwner = void 0;
            this.hasLastError = false;
        }
    }
    getLastError() {
        return this.lastError;
    }
    suspend(args) {
        const state = this.data;
        const key = this.keyOf(args);
        if (state.status === EResourceStatus.Success && this.settledKey === key) return state.data;
        if (state.status === EResourceStatus.Error && this.settledKey === key) throw this.hasLastError ? this.lastError : new Error(state.error || 'Carburetor: resource failed');
        if (this.pendingRequest && this.pendingKey === key) throw this.pendingRequest;
        throw this.start(args, true);
    }
    load(args) {
        return this.start(args, false);
    }
    reload() {
        if (void 0 === this.lastKey) return Promise.resolve();
        const args = this.lastArgs;
        this.pendingKey = void 0;
        this.pendingRequest = void 0;
        return this.start(args, false);
    }
    abort() {
        if (!this.controller) return;
        const operationVersion = ++this.operationVersion;
        this.cancelInFlight();
        if (this.operationVersion !== operationVersion) return;
        this.draft.status = EResourceStatus.Idle;
        this.emitUpdate();
    }
    cancelInFlight() {
        const controller = this.controller;
        if (!controller) return;
        this.controller = void 0;
        this.pendingRequest = void 0;
        this.pendingKey = void 0;
        controller.abort();
    }
    start(args, deferNotification) {
        const key = this.keyOf(args);
        if (this.pendingRequest && this.pendingKey === key) return this.pendingRequest;
        const operationVersion = ++this.operationVersion;
        this.cancelInFlight();
        if (this.operationVersion !== operationVersion) {
            if (this.pendingKey === key && this.pendingRequest) return this.pendingRequest;
            return Promise.reject(createSupersededError());
        }
        const controller = createAbortHandle();
        this.controller = controller;
        this.pendingKey = key;
        this.lastArgs = args;
        this.lastKey = key;
        this.hasLastError = false;
        this.settledKey = void 0;
        this.draft.status = EResourceStatus.Pending;
        this.draft.error = void 0;
        let resolveRequest = ()=>void 0;
        let rejectRequest = ()=>void 0;
        const request = new Promise((resolve, reject)=>{
            resolveRequest = resolve;
            rejectRequest = reject;
        });
        this.pendingRequest = request;
        if (deferNotification) this.emitSoon();
        else this.emitUpdate();
        if (!this.isCurrent(controller)) {
            rejectRequest(createSupersededError());
            return request;
        }
        let answer;
        try {
            answer = this.loader(args, controller.signal);
        } catch (error) {
            answer = Promise.reject(error);
        }
        answer.then((data)=>{
            this.settleSuccess(controller, key, data);
        }, (error)=>{
            this.settleError(controller, key, error);
        }).then(resolveRequest, rejectRequest);
        return request;
    }
    keyOf(args) {
        return JSON.stringify(void 0 === args ? null : args);
    }
    isCurrent(controller) {
        return this.controller === controller && !controller.signal.aborted;
    }
    settleSuccess(controller, key, data) {
        if (!this.isCurrent(controller)) return;
        this.controller = void 0;
        this.pendingRequest = void 0;
        this.settledKey = key;
        this.lastError = void 0;
        this.hasLastError = false;
        this.draft.status = EResourceStatus.Success;
        this.draft.data = data;
        this.draft.error = void 0;
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    }
    settleError(controller, key, error) {
        if (!this.isCurrent(controller)) return;
        const message = describeError(error);
        this.controller = void 0;
        this.pendingRequest = void 0;
        this.settledKey = key;
        this.lastError = error;
        this.lastErrorMessage = message;
        this.errorOwner = this.data;
        this.hasLastError = true;
        this.draft.status = EResourceStatus.Error;
        this.draft.error = message;
        this.draft.updatedAt = Date.now();
        this.emitUpdate();
    }
}
export { ResourceCarburetor };
