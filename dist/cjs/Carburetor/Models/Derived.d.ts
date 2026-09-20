import { TReadonly } from "./Base.js";
import { ICarburetor, ICarburetorSubscription } from "./Store.js";
/** A memoized derived value that tracks its own dependencies. */
export interface IComputed<R> extends ICarburetorSubscription {
    get: () => R;
}
/**
 * Reads a dependency with tracking, from inside a computed body. A carburetor is tracked
 * per path; another computed is tracked as a whole, because its value is the granularity
 * it notifies at. Reading a computed any other way — calling `get()` on it directly —
 * registers no dependency and leaves the outer value stale.
 */
export type TComputedReader = (<T extends object>(carburetor: ICarburetor<T>) => TReadonly<T>) & (<R>(computed: IComputed<R>) => R);
/** Body of a computed: everything it reads through `read` becomes its dependency. */
export type TComputeBody<R> = (read: TComputedReader) => R;
