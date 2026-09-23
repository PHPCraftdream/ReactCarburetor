import {IDict} from "@/Carburetor/Models/Base";
import {IInspectable} from "@/Carburetor/Models/Store";
import {ICarburetorToken} from "@/Carburetor/Models/Tooling";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";

/**
 * One set of carburetor instances. Create a scope per server request instead of keeping
 * module-level singletons: a singleton on the server is shared by every request, which
 * leaks one user's state into another's render.
 */
export class CarburetorScope {
    /** The instances created or installed in this scope so far, keyed by token id. */
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

    /**
     * Replaces an instance — useful for tests and for hydrating a prepared store.
     *
     * @param token - names the slot replaced; later `get` calls for it return the new instance
     * @param instance - stored as-is under the token's id; the factory inside the token never runs
     */
    public set = <T extends unknown>(token: ICarburetorToken<T>, instance: T): void => {
        this.instances.set(token.id, instance);
    };

    /** Whether this scope already created an instance for the token. */
    public has = <T extends unknown>(token: ICarburetorToken<T>): boolean => {
        return this.instances.has(token.id);
    };

    /**
     * Serializable state of every carburetor created in this scope, keyed by token name.
     * Take this after rendering on the server and send it to the client.
     */
    public dehydrate = (): IDict<unknown> => {
        // Object.fromEntries creates own data properties (CreateDataPropertyOrThrow), unlike
        // `state[id] = value`, which would invoke the inherited `__proto__` accessor setter
        // for an id literally named "__proto__" instead of storing it as an own key.
        const entries: Array<[string, unknown]> = [];

        this.instances.forEach((instance: unknown, id: string) => {
            if (this.isInspectable(instance)) {
                entries.push([id, instance.toJSON()]);
            }
        });

        return Object.fromEntries(entries);
    };

    /**
     * Restores state produced by dehydrate. Tokens whose state is present are instantiated,
     * so the client starts from the same data the server rendered; anything not mentioned in
     * the payload is left to be created on demand.
     *
     * A payload key matching no token is the reverse case: the server sent data the client has
     * no token for. A client deliberately hydrating a subset makes that legitimate, so it is
     * not an error — but it is also exactly what the server and the client declaring one token
     * under different names looks like, so development reports it instead of dropping it
     * silently.
     *
     * @param state - the dehydrate() payload, keyed by token name; keys no token claims are
     * reported in development and otherwise ignored
     * @param tokens - the tokens to restore; ones absent from `state` are left to be created
     * on demand instead
     */
    public hydrate = (state: IDict<unknown>, tokens: ReadonlyArray<ICarburetorToken<unknown>>): void => {
        const claimed = new Set<string>();

        tokens.forEach((token: ICarburetorToken<unknown>) => {
            // Own keys only: a token named like an Object.prototype member must not match.
            if (!Object.prototype.hasOwnProperty.call(state, token.id)) {
                return;
            }

            claimed.add(token.id);

            const instance = this.get(token);

            if (this.isInspectable(instance)) {
                instance.fromJSON(state[token.id]);
            }
        });

        if (IS_DEVELOPMENT) {
            const unclaimed = Object.keys(state).filter((key: string) => !claimed.has(key));

            if (unclaimed.length > 0) {
                diagnostics.report(
                    'hydrate() was handed state under keys no token claims: ' +
                    unclaimed.map((key: string) => '"' + key + '"').join(', ') +
                    '. Those entries were ignored; if one of them looks like a token name, the ' +
                    'server and the client declare that token under different names.'
                );
            }
        }
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
