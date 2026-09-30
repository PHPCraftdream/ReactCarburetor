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
/** Options a computed can be built with; see `computed()`. */
export interface IComputedOptions<R> {
    /**
     * Judges two results equal by content instead of by reference. Consulted only when the
     * reference actually changed: an in-place mutation of an exotic result (a `Map`/`Set`, or a
     * plain envelope wrapping one) is still judged by its moved dependencies regardless of
     * `equals`, because `previous` and `next` would alias the very same mutated object and
     * `equals` could never see the change that mutation tracking already earned.
     *
     * @param previous - the value last announced to subscribers
     * @param next - the value this recompute just produced
     */
    equals?: (previous: R, next: R) => boolean;
}
