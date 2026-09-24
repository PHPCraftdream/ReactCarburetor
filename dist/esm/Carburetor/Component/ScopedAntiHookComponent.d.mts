import { ICarburetorToken } from "../Models/Tooling.mjs";
import { AntiHookComponent } from "./AntiHookComponent/AntiHookComponent.mjs";
import { CarburetorScope } from "./Scope/CarburetorScope.mjs";
/**
 * A component that resolves its carburetors from the surrounding scope rather than from
 * module-level singletons. Uses `contextType`, so no hooks are involved.
 */
export declare class ScopedAntiHookComponent<P = {}, S = {}> extends AntiHookComponent<P, S> {
    /** Makes React populate each instance's `context` with the surrounding CarburetorScope. */
    static contextType: import("react").Context<CarburetorScope | null>;
    /** The scope React fills in from contextType; null until a provider mounts above. */
    context: CarburetorScope | null;
    /** The surrounding scope, or a loud error: a missing provider is a wiring mistake. */
    protected scope(): CarburetorScope;
    /** The carburetor this token stands for in the current scope. */
    protected resolve<T extends unknown>(token: ICarburetorToken<T>): T;
}
