import {ICarburetorToken} from "@/Carburetor/Models/Tooling";
import {AntiHookComponent} from "./AntiHookComponent";
import {CarburetorContext} from "./Scope/CarburetorContext";
import {CarburetorScope} from "./Scope/CarburetorScope";

/**
 * A component that resolves its carburetors from the surrounding scope rather than from
 * module-level singletons. Uses `contextType`, so no hooks are involved.
 */
export class ScopedAntiHookComponent<P = {}, S = {}> extends AntiHookComponent<P, S> {
    public static contextType = CarburetorContext;

    declare public context: CarburetorScope | null;

    protected scope(): CarburetorScope {
        if (!this.context) {
            throw new Error(
                'Carburetor: no scope found. Wrap the tree in <CarburetorProvider scope={...}> ' +
                'before using a scoped component.'
            );
        }

        return this.context;
    }

    protected resolve<T extends unknown>(token: ICarburetorToken<T>): T {
        return this.scope().get(token);
    }
}
