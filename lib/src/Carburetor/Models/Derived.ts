import {TReadonly} from "./Base";
import {ICarburetor, ICarburetorSubscription} from "./Store";

/** A memoized derived value that tracks its own dependencies. */
export interface IComputed<R> extends ICarburetorSubscription {
    get: () => R;
}

/** Reads a carburetor with tracking; used inside a computed body. */
export type TComputedReader = <T extends {}>(carburetor: ICarburetor<T>) => TReadonly<T>;

/** Body of a computed: everything it reads through `read` becomes its dependency. */
export type TComputeBody<R> = (read: TComputedReader) => R;
