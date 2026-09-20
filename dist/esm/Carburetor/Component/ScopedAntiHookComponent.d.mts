import { ICarburetorToken } from "../Models/Tooling.mjs";
import { AntiHookComponent } from "./AntiHookComponent.mjs";
import { CarburetorScope } from "./CarburetorScope.mjs";
/**
 * A component that resolves its carburetors from the surrounding scope rather than from
 * module-level singletons. Uses `contextType`, so no hooks are involved.
 */
export declare class ScopedAntiHookComponent<P = {}, S = {}> extends AntiHookComponent<P, S> {
    static contextType: import("react").Context<CarburetorScope | null>;
    context: CarburetorScope | null;
    protected scope(): CarburetorScope;
    protected resolve<T extends unknown>(token: ICarburetorToken<T>): T;
}
