import {ICarburetorToken} from "@/Carburetor/Models/Tooling";
import {AntiHookComponent} from "./AntiHookComponent";
import {CarburetorContext} from "./Scope/CarburetorContext";
import {CarburetorScope} from "./Scope/CarburetorScope";

/**
 * A component that resolves its carburetors from the surrounding scope rather than from
 * module-level singletons. Uses `contextType`, so no hooks are involved.
 */
export class ScopedAntiHookComponent<P = {}, S = {}> extends AntiHookComponent<P, S> {
    /** Makes React populate each instance's `context` with the surrounding CarburetorScope. */
    public static contextType = CarburetorContext;

    /** The scope React fills in from contextType; null until a provider mounts above. */
    declare public context: CarburetorScope | null;

    /** The surrounding scope, or a loud error: a missing provider is a wiring mistake. */
    protected scope(): CarburetorScope {
        if (!this.context) {
            throw new Error(
                'Carburetor: no scope found. Wrap the tree in <CarburetorProvider scope={...}> ' +
                'before using a scoped component.'
            );
        }

        return this.context;
    }

    /** The carburetor this token stands for in the current scope. */
    protected resolve<T extends unknown>(token: ICarburetorToken<T>): T {
        return this.scope().get(token);
    }
}
