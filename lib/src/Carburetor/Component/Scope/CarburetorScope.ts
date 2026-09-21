import {IDict} from "@/Carburetor/Models/Base";
import {IInspectable} from "@/Carburetor/Models/Store";
import {ICarburetorToken} from "@/Carburetor/Models/Tooling";

/**
 * One set of carburetor instances. Create a scope per server request instead of keeping
 * module-level singletons: a singleton on the server is shared by every request, which
 * leaks one user's state into another's render.
 */
export class CarburetorScope {
    protected instances: Map<string, unknown> = new Map<string, unknown>();

    /** The instance this token stands for, created once per scope on first use. */
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

    /** Whether this scope already created an instance for the token. */
    public has = <T extends unknown>(token: ICarburetorToken<T>): boolean => {
        return this.instances.has(token.id);
    };

    /**
     * Serializable state of every carburetor created in this scope, keyed by token id.
     * Take this after rendering on the server and send it to the client.
     */
    public dehydrate = (): IDict<unknown> => {
        const state: IDict<unknown> = {};

        this.instances.forEach((instance: unknown, id: string) => {
            if (this.isInspectable(instance)) {
                state[id] = instance.toJSON();
            }
        });

        return state;
    };

    /**
     * Restores state produced by dehydrate. Tokens whose state is present are instantiated,
     * so the client starts from the same data the server rendered; anything not mentioned in
     * the payload is left to be created on demand.
     */
    public hydrate = (state: IDict<unknown>, tokens: ReadonlyArray<ICarburetorToken<unknown>>): void => {
        tokens.forEach((token: ICarburetorToken<unknown>) => {
            if (!(token.id in state)) {
                return;
            }

            const instance = this.get(token);

            if (this.isInspectable(instance)) {
                instance.fromJSON(state[token.id]);
            }
        });
    };

    /** Whether an instance can be serialized: a scope may hold things that cannot. */
    protected isInspectable = (instance: unknown): instance is IInspectable => {
        if (typeof instance !== 'object' || instance === null) {
            return false;
        }

        const candidate = instance as {toJSON?: unknown; fromJSON?: unknown};

        return typeof candidate.toJSON === 'function' && typeof candidate.fromJSON === 'function';
    };
}
