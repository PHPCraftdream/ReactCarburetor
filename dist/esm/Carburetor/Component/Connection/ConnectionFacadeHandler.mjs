import { PROXY_CACHE } from "../../Store/Tracking/Models.mjs";
const forbidWrite = ()=>{
    throw new Error("Carburetor: data read through connect() is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
};
class ConnectionFacadeHandler {
    source;
    constructor(source){
        this.source = source;
    }
    assertDeclaredKind(data) {
        const { source } = this;
        if (Array.isArray(data) === source.arrayFacade) return;
        const mismatch = new Error(source.arrayFacade ? "Carburetor: this connect() view was declared for an array root, but its source now resolves to a root that is not an array. One persistent view cannot change its object/array kind; declare a separate connection for the other store." : void 0 === source.probeError ? "Carburetor: this connect() view is fixed as an object view because its source was not resolvable at declaration time (a scope-backed resolver resolves after construction), but the resolved root is an array. Read an array-rooted scoped store through useCarburetor in render instead." : 'Carburetor: this connect() view is fixed as an object view because reading its source threw during declaration (see this error\'s "cause") — a scope-backed resolver not yet ready throws the same way, but this may instead be a genuine resolver bug — and the resolved root is now an array. Read an array-rooted scoped store through useCarburetor in render instead.');
        if (void 0 !== source.probeError) mismatch.cause = source.probeError;
        throw mismatch;
    }
    resolveView() {
        const { source } = this;
        const carburetor = source.resolveAttemptSource();
        const data = carburetor.getData();
        if (source.cachedTarget !== data) {
            this.assertDeclaredKind(data);
            source.cachedTarget = data;
            source.cachedView = carburetor.read(source.recorder);
        }
        return source.cachedView;
    }
    get(_target, key) {
        if (key === PROXY_CACHE) {
            const { cachedView } = this.source;
            return void 0 === cachedView ? void 0 : Reflect.get(cachedView, PROXY_CACHE);
        }
        return Reflect.get(this.resolveView(), key);
    }
    has(_target, key) {
        return Reflect.has(this.resolveView(), key);
    }
    ownKeys(_target) {
        return Reflect.ownKeys(this.resolveView());
    }
    getOwnPropertyDescriptor(_target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(this.resolveView(), key);
        if (void 0 === descriptor || descriptor.configurable) return descriptor;
        const targetDescriptor = Reflect.getOwnPropertyDescriptor(_target, key);
        if (void 0 !== targetDescriptor && !targetDescriptor.configurable) return descriptor;
        return {
            ...descriptor,
            configurable: true
        };
    }
    getPrototypeOf(_target) {
        return Reflect.getPrototypeOf(this.resolveView());
    }
    setPrototypeOf() {
        return forbidWrite();
    }
    preventExtensions() {
        return forbidWrite();
    }
    set() {
        return forbidWrite();
    }
    defineProperty() {
        return forbidWrite();
    }
    deleteProperty() {
        return forbidWrite();
    }
}
export { ConnectionFacadeHandler };
