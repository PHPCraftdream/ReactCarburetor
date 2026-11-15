import {CarburetorScope} from './CarburetorScope';
import {ICarburetorToken} from '../../Models/Tooling';

type TChildScopeClass = new (
    parent: CarburetorScope, localTokens: readonly ICarburetorToken<unknown>[]
) => CarburetorScope;

/** The one child scope class, defined on first use; see `defineChildScope`. */
let childScopeClass: TChildScopeClass | undefined;

/**
 * Defines the child scope class. Inside a function, not at module level: `CarburetorScope`'s own
 * module imports this one, so the base class may not exist yet while this module is evaluated.
 * It runs once; every child scope is an instance of the same class, so call sites that resolve
 * tokens through many children keep seeing one shape.
 */
const defineChildScope = (): TChildScopeClass => {
    class ChildScope extends CarburetorScope {
        /** Ids of the tokens this child creates and owns. */
        protected readonly localIds: Set<string>;
        /** Instances resolved through the parent, cached per token id. */
        protected readonly delegated = new Map<string, unknown>();

        /** Binds the child to the scope that resolves every token it does not own.
         *
         * @param parent - owning scope used for delegated token resolution
         * @param localTokens - tokens instantiated and owned by this child
         */
        public constructor(parent: CarburetorScope, localTokens: readonly ICarburetorToken<unknown>[]) {
            super();
            this.scopeParent = parent;
            this.localIds = new Set<string>();
            for (const token of localTokens) this.localIds.add(token.id);
        }

        /** Resolve a local token or delegate to the parent.
         *
         * @param token - token to resolve
         */
        public get<T extends unknown>(token: ICarburetorToken<T>): T {
            if (this.disposed) throw new Error('CarburetorScope: scope is disposed');
            if (this.instances.has(token.id) || this.localIds.has(token.id)) {
                const value = super.get(token);
                return value;
            }
            if (this.delegated.has(token.id)) return this.delegated.get(token.id) as T;
            const value = (this.scopeParent as CarburetorScope).get(token);
            if (this.disposed) throw new Error('CarburetorScope: scope is disposed');
            this.delegated.set(token.id, value);
            return value;
        }

        /** Replace a locally owned token slot.
         *
         * @param token - token whose slot is replaced
         * @param instance - instance to own in this child scope
         */
        public set<T extends unknown>(token: ICarburetorToken<T>, instance: T): void {
            super.set(token, instance);
            this.delegated.delete(token.id);
        }

        /** Restore child-local serialized state.
         *
         * @param state - child-local serialized values
         * @param tokens - optional tokens to hydrate eagerly
         */
        public hydrate(state: Record<string, unknown>, tokens?: readonly ICarburetorToken<unknown>[]): void {
            const selected = tokens?.filter(token => this.localIds.has(token.id)
                || this.instances.has(token.id));
            super.hydrate(state, selected);
        }

        /** Disposes the owned instances and forgets the delegated ones. */
        public dispose(): void {
            try { super.dispose(); }
            finally { this.delegated.clear(); }
        }
    }

    return ChildScope;
};

/** Creates a child scope while preserving the parent's normal get() behavior.
 *
 * @param parent - owning scope used for delegated token resolution
 * @param localTokens - tokens instantiated and owned by this child
 */
export function createChildScope(parent: CarburetorScope,
    localTokens: readonly ICarburetorToken<unknown>[]): CarburetorScope {
    return new (childScopeClass ??= defineChildScope())(parent, localTokens);
}
