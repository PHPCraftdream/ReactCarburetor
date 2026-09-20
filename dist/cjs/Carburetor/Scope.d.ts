import * as React from "react";
import { AntiHookComponent } from "./AntiHookComponent.js";
/**
 * Identifies a carburetor inside a scope and knows how to build it.
 * A token is a module-level constant; the instances it produces are not.
 */
export interface ICarburetorToken<T> {
    id: string;
    create: () => T;
}
export declare const carburetorToken: <T extends unknown>(create: () => T) => ICarburetorToken<T>;
/**
 * One set of carburetor instances. Create a scope per server request instead of keeping
 * module-level singletons: a singleton on the server is shared by every request, which
 * leaks one user's state into another's render.
 */
export declare class CarburetorScope {
    protected instances: Map<string, unknown>;
    get: <T extends unknown>(token: ICarburetorToken<T>) => T;
    /** Replaces an instance — useful for tests and for hydrating a prepared store. */
    set: <T extends unknown>(token: ICarburetorToken<T>, instance: T) => void;
    has: <T extends unknown>(token: ICarburetorToken<T>) => boolean;
}
export declare const CarburetorContext: React.Context<CarburetorScope | null>;
interface ICarburetorProviderProps {
    scope: CarburetorScope;
    children?: React.ReactNode;
}
export declare class CarburetorProvider extends React.Component<ICarburetorProviderProps> {
    render(): React.JSX.Element;
}
/**
 * A component that resolves its carburetors from the surrounding scope rather than from
 * module-level singletons. Uses `contextType`, so no hooks are involved.
 */
export declare class ScopedAntiHookComponent<P = {}, S = {}> extends AntiHookComponent<P, S> {
    static contextType: React.Context<CarburetorScope | null>;
    context: CarburetorScope | null;
    protected scope(): CarburetorScope;
    protected resolve<T extends unknown>(token: ICarburetorToken<T>): T;
}
export {};
