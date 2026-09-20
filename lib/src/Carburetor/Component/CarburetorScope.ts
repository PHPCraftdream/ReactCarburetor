import {ICarburetorToken} from "../Models/Tooling";

/**
 * One set of carburetor instances. Create a scope per server request instead of keeping
 * module-level singletons: a singleton on the server is shared by every request, which
 * leaks one user's state into another's render.
 */
export class CarburetorScope {
    protected instances: Map<string, unknown> = new Map<string, unknown>();

    public get = <T extends unknown>(token: ICarburetorToken<T>): T => {
        if (this.instances.has(token.id)) {
            return this.instances.get(token.id) as T;
        }

        const created = token.create();
        this.instances.set(token.id, created);

        return created;
    };

    /** Replaces an instance — useful for tests and for hydrating a prepared store. */
    public set = <T extends unknown>(token: ICarburetorToken<T>, instance: T): void => {
        this.instances.set(token.id, instance);
    };

    public has = <T extends unknown>(token: ICarburetorToken<T>): boolean => {
        return this.instances.has(token.id);
    };
}
