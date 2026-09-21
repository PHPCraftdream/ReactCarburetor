import { IDict } from "../../Models/Base.js";
import { IInspectable } from "../../Models/Store.js";
import { ICarburetorToken } from "../../Models/Tooling.js";
/**
 * One set of carburetor instances. Create a scope per server request instead of keeping
 * module-level singletons: a singleton on the server is shared by every request, which
 * leaks one user's state into another's render.
 */
export declare class CarburetorScope {
    protected instances: Map<string, unknown>;
    /** The instance this token stands for, created once per scope on first use. */
    get: <T extends unknown>(token: ICarburetorToken<T>) => T;
    /** Replaces an instance — useful for tests and for hydrating a prepared store. */
    set: <T extends unknown>(token: ICarburetorToken<T>, instance: T) => void;
    /** Whether this scope already created an instance for the token. */
    has: <T extends unknown>(token: ICarburetorToken<T>) => boolean;
    /**
     * Serializable state of every carburetor created in this scope, keyed by token id.
     * Take this after rendering on the server and send it to the client.
     */
    dehydrate: () => IDict<unknown>;
    /**
     * Restores state produced by dehydrate. Tokens whose state is present are instantiated,
     * so the client starts from the same data the server rendered; anything not mentioned in
     * the payload is left to be created on demand.
     */
    hydrate: (state: IDict<unknown>, tokens: ReadonlyArray<ICarburetorToken<unknown>>) => void;
    /** Whether an instance can be serialized: a scope may hold things that cannot. */
    protected isInspectable: (instance: unknown) => instance is IInspectable;
}
