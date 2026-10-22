"use client";

import {ICarburetorToken} from "../Models/Tooling";
import {AntiHookComponent} from "./AntiHookComponent/AntiHookComponent";
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

    /**
     * The carburetor this token stands for in the current scope: the same answer as
     * `this.scope().get(token)`.
     *
     * A class that declares its own `static contextType` breaks the scope reading done here;
     * such components must read the scope manually from the CarburetorProvider context.
     */
    protected scoped<T extends unknown>(token: ICarburetorToken<T>): T {
        return this.scope().get(token);
    }

    /** Former name of `scoped`, kept as a delegate for existing callers. */
    protected resolve<T extends unknown>(token: ICarburetorToken<T>): T {
        return this.scoped(token);
    }
}
