import { AntiHookComponent } from "./AntiHookComponent.mjs";
import { getUid } from "./Utils/getUid.mjs";
import * as __rspack_external_react from "react";
const carburetorToken = (create)=>({
        id: getUid(),
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
const CarburetorContext = /*#__PURE__*/ __rspack_external_react.createContext(null);
class CarburetorProvider extends __rspack_external_react.Component {
    render() {
        return /*#__PURE__*/ __rspack_external_react.createElement(CarburetorContext.Provider, {
            value: this.props.scope
        }, this.props.children);
    }
}
class ScopedAntiHookComponent extends AntiHookComponent {
    static contextType = CarburetorContext;
    scope() {
        if (!this.context) throw new Error("Carburetor: no scope found. Wrap the tree in <CarburetorProvider scope={...}> before using a scoped component.");
        return this.context;
    }
    resolve(token) {
        return this.scope().get(token);
    }
}
export { CarburetorContext, CarburetorProvider, CarburetorScope, ScopedAntiHookComponent, carburetorToken };
