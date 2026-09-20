import { ICarburetorToken } from "../Models/Tooling.mjs";
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
