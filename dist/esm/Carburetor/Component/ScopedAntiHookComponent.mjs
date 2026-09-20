import { AntiHookComponent } from "./AntiHookComponent.mjs";
import { CarburetorContext } from "./CarburetorContext.mjs";
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
export { ScopedAntiHookComponent };
