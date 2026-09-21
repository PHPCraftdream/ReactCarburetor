import { ICarburetorToken } from "../Models/Tooling.js";
import { AntiHookComponent } from "./AntiHookComponent.js";
import { CarburetorScope } from "./Scope/CarburetorScope.js";
/**
 * A component that resolves its carburetors from the surrounding scope rather than from
 * module-level singletons. Uses `contextType`, so no hooks are involved.
 */
export declare class ScopedAntiHookComponent<P = {}, S = {}> extends AntiHookComponent<P, S> {
    static contextType: import("react").Context<CarburetorScope | null>;
    context: CarburetorScope | null;
    /** The surrounding scope, or a loud error: a missing provider is a wiring mistake. */
    protected scope(): CarburetorScope;
    /** The carburetor this token stands for in the current scope. */
    protected resolve<T extends unknown>(token: ICarburetorToken<T>): T;
}
