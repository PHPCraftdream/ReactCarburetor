import {IDict} from "@/Carburetor/Models/Base";
import {IInspectable} from "@/Carburetor/Models/Store";
import {ICarburetorToken} from "@/Carburetor/Models/Tooling";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";

const quoteKey = (key: string): string => '"' + key + '"';

/**
 * One set of carburetor instances. Create a scope per server request instead of keeping
 * module-level singletons: a singleton on the server is shared by every request, which leaks
 * one user's state into another's render.
 *
 * A scope owns every distinct instance created or installed in it, including replaced instances,
 * and disposes them in reverse ownership order.
 */
export class CarburetorScope {
    /** The instances created or installed in this scope so far, keyed by token id. */
    protected instances: Map<string, unknown> = new Map<string, unknown>();

    /** Payload remembered by a token-less hydrate() call, applied lazily on first get.
     *  A repeated lazy hydrate() merges its payload into this (new entries win) and applies
     *  new values to already created instances via fromJSON. */
    protected lazyHydration: IDict<unknown> | undefined = undefined;
    /** Distinct owned instances in order of first ownership; disposed in reverse. */
    protected readonly creationOrder: unknown[] = [];
    /** Token ids whose factories are running, for dependency-cycle errors. */
    protected readonly resolving: string[] = [];
    /** Set once by dispose(); get, set and hydrate refuse afterwards. */
    protected disposed = false;

    /**
     * The instance this token stands for, created once per scope on first use.
     *
     * A method, not an arrow field: every overridable member below is, so a subclass override
     * lands on the prototype instead of an own property shadowing it.
     * A failed lazy hydration leaves the token uncreated so a later get() retries.
     *
     * @param token - identifies the slot to create or retrieve
     */
    public get<T extends unknown>(token: ICarburetorToken<T>): T {
        if (this.disposed) throw new Error('CarburetorScope: scope is disposed');
        if (this.instances.has(token.id)) return this.instances.get(token.id) as T;
        const cycleAt = this.resolving.indexOf(token.id);
        if (cycleAt !== -1) {
            const chain = [...this.resolving.slice(cycleAt), token.id].join(' -> ');
            throw new Error('CarburetorScope: dependency cycle: ' + chain);
        }
        this.resolving.push(token.id);
        let created: T;
        try { created = token.create(this); }
        catch (error) { this.resolving.pop(); throw error; }
        this.resolving.pop();
        if (this.disposed) {
            const disposedError = new Error('CarburetorScope: scope is disposed');
            try { (created as {dispose?: () => void} | null)?.dispose?.(); } catch { /* the disposed error wins */ }
            throw disposedError;
        }
        this.instances.set(token.id, created);
        if (!this.creationOrder.includes(created)) this.creationOrder.push(created);
        if (this.lazyHydration !== undefined
            && Object.prototype.hasOwnProperty.call(this.lazyHydration, token.id)
            && this.isInspectable(created)) {
            try {
                // Own keys only: a token named like an Object.prototype member must not match.
                // Cloned, not adopted — same reason as in the eager hydrate() branch.
                created.fromJSON(deepClone(this.lazyHydration[token.id]));
            } catch (error) {
                // Keep the failed object in creationOrder: it remains scope-owned and must be
                // disposed even though get() removes its unusable token slot for a later retry.
                if (this.instances.get(token.id) === created) {
                    this.instances.delete(token.id);
                }
                if (this.disposed) throw new Error('CarburetorScope: scope is disposed');
                throw error;
            }
        }
        if (this.disposed) throw new Error('CarburetorScope: scope is disposed');
        return created;
    }

    /**
     * Replaces an instance — useful for tests and for hydrating a prepared store.
     *
     * @param token - names the slot replaced; later `get` calls for it return the new instance
     * @param instance - stored as-is under the token's id; the factory inside the token never runs;
     * a pending lazy hydrate() entry for the token is dropped, so `set` wins over the payload
     */
    public set<T extends unknown>(token: ICarburetorToken<T>, instance: T): void {
        if (this.disposed) throw new Error('CarburetorScope: scope is disposed');
        const old = this.instances.get(token.id);
        if (old === undefined || old !== instance) {
            if (!this.creationOrder.includes(instance)) this.creationOrder.push(instance);
            if (old !== undefined && !this.creationOrder.includes(old)) this.creationOrder.push(old);
        }
        this.instances.set(token.id, instance);
        if (this.lazyHydration !== undefined && Object.prototype.hasOwnProperty.call(this.lazyHydration, token.id)) {
            delete this.lazyHydration[token.id];
        }
    }

    /** Whether this scope already created an instance for the token.
     *
     * @param token - identifies the slot to check
     */
    public has<T extends unknown>(token: ICarburetorToken<T>): boolean {
        return this.instances.has(token.id);
    }

    /** Dispose owned instances once, in reverse ownership order, continuing after errors.
     */
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        let failed = false;
        let firstError: unknown;
        const seen = new Set<unknown>();
        for (let index = this.creationOrder.length - 1; index >= 0; index--) {
            const instance = this.creationOrder[index];
            if (seen.has(instance)) continue;
            seen.add(instance);
            if (typeof (instance as {dispose?: unknown} | null)?.dispose !== 'function') continue;
            try { (instance as {dispose: () => void}).dispose(); }
            catch (error) { if (!failed) { failed = true; firstError = error; } }
        }
        this.creationOrder.length = 0;
        this.instances.clear();
        if (failed) throw firstError;
    }

    /**
     * Serializable state of every carburetor created in this scope, keyed by token name.
     * Take this after rendering on the server and send it to the client.
     *
     * A detached copy per instance, not its live wire form: the payload must survive the server
     * rendering that produced it. For a one-pass serialize of the live state use `toJSON()`.
     */
    public dehydrate(): IDict<unknown> {
        // Object.fromEntries creates own data properties (CreateDataPropertyOrThrow), unlike
        // `state[id] = value`, which would invoke the inherited `__proto__` accessor setter
        // for an id literally named "__proto__" instead of storing it as an own key.
        const entries: Array<[string, unknown]> = [];

        this.instances.forEach((instance: unknown, id: string) => {
            if (this.isInspectable(instance)) {
                entries.push([id, instance.snapshot()]);
            }
        });

        return Object.fromEntries(entries);
    }

    /**
     * The wire form of every inspected carburetor, keyed by token id: what `JSON.stringify(scope)`
     * serializes, in one pass and without the per-instance copy `dehydrate()` makes. Unlike
     * `dehydrate()` the payload is live — a write after it was taken shows up in it.
     *
     * The same JSON as `JSON.stringify(dehydrate())` for classes whose wire form matches their
     * snapshot (the persist contract: `JSON.stringify(carburetor)`).
     */
    public toJSON(): IDict<unknown> {
        // Object.fromEntries as in dehydrate(): an id named "__proto__" stays an own key.
        const entries: Array<[string, unknown]> = [];

        this.instances.forEach((instance: unknown, id: string) => {
            if (this.isInspectable(instance)) {
                entries.push([id, instance.toJSON()]);
            }
        });

        return Object.fromEntries(entries);
    }

    /**
     * Restores state produced by dehydrate. Tokens whose state is present are instantiated,
     * so the client starts from the same data the server rendered; anything not mentioned in
     * the payload is left to be created on demand.
     *
     * Without `tokens` the payload is kept and applied lazily: the first `get()` of a token
     * whose key is present in the payload restores its state. A token the client forgot to
     * list therefore keeps its state instead of silently starting fresh, and payload keys the
     * client never resolves are simply unused — no development report is made for them in
     * this mode.
     *
     * With `tokens` the listed tokens are restored eagerly, as before.
     *
     * A payload key matching no token is the reverse case: the server sent data the client has
     * no token for. A client deliberately hydrating a subset makes that legitimate, so it is
     * not an error — but it is also exactly what the server and the client declaring one token
     * under different names looks like, so development reports it instead of dropping it
     * silently.
     *
     * @param state - the dehydrate() payload, keyed by token name; keys no token claims are
     * reported in development and otherwise ignored; a second token-less call merges its
     * payload into the pending one (new entries win) and immediately applies new values to
     * already created instances via fromJSON()
     * @param tokens - optional tokens to restore eagerly; without them every payload key is
     * applied lazily, on the first `get()` of the token it names; absent from `state`, the
     * listed tokens are left to be created on demand instead
     */
    public hydrate(state: IDict<unknown>, tokens?: ReadonlyArray<ICarburetorToken<unknown>>): void {
        if (this.disposed) throw new Error('CarburetorScope: scope is disposed');
        if (tokens === undefined) {
            // Cloned, not adopted: `state` is the caller's own payload and may keep being
            // mutated after the call — the lazy application must not see that.
            const cloned = deepClone(state);

            if (this.lazyHydration === undefined) {
                this.lazyHydration = cloned;
            } else {
                const pending = this.lazyHydration;

                // Merge: new entries overwrite pending ones for the same key; entries from an
                // earlier payload under other keys are kept.
                Object.keys(cloned).forEach((key: string) => {
                    pending[key] = cloned[key];
                });
            }

            // Apply new values to already created instances right away; the pending entry stays
            // untouched (cloned again) so a later get() of a not-yet-created token still uses it.
            Object.keys(cloned).forEach((key: string) => {
                const instance = this.instances.get(key);

                if (instance !== undefined && this.isInspectable(instance)) {
                    instance.fromJSON(deepClone(cloned[key]));
                }
            });

            return;
        }

        const claimed = new Set<string>();

        tokens.forEach((token: ICarburetorToken<unknown>) => {
            // Own keys only: a token named like an Object.prototype member must not match.
            if (!Object.prototype.hasOwnProperty.call(state, token.id)) {
                return;
            }

            claimed.add(token.id);

            const instance = this.get(token);

            if (this.isInspectable(instance)) {
                // Cloned, not adopted: fromJSON() now takes ownership of what it is handed,
                // but `state` here is the caller's own payload, possibly hydrated into
                // more than one scope from — independent scopes must not end up sharing it.
                instance.fromJSON(deepClone(state[token.id]));
            }
        });

        if (IS_DEVELOPMENT) {
            const unclaimed = Object.keys(state).filter((key: string) => !claimed.has(key));

            if (unclaimed.length > 0) {
                diagnostics.report(
                    'hydrate() was handed state under keys no token claims: ' +
                    unclaimed.map(quoteKey).join(', ') +
                    '. Those entries were ignored; if one of them looks like a token name, the ' +
                    'server and the client declare that token under different names.'
                );
            }
        }
    }

    /** Whether an instance can be serialized.
     *
     * @param instance - instance to inspect for the serialization interface
     */
    protected isInspectable(instance: unknown): instance is IInspectable {
        if (typeof instance !== 'object' || instance === null) {
            return false;
        }

        const candidate = instance as {toJSON?: unknown; fromJSON?: unknown; snapshot?: unknown};

        return typeof candidate.toJSON === 'function' && typeof candidate.fromJSON === 'function'
            && typeof candidate.snapshot === 'function';
    }
}
