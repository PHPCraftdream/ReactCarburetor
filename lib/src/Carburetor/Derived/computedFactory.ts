import {IComputedOptions, TComputeBody} from "@/Carburetor/Models/Derived";
import {Computed} from "./Computed";

/**
 * Builds a memoized derived value from the body that computes it.
 *
 * @param body - runs against a tracking reader; everything it reads becomes a dependency
 * @param options - `equals` judges two results by content instead of by reference
 */
export const computed = <R>(body: TComputeBody<R>, options?: IComputedOptions<R>): Computed<R> => {
    return new Computed<R>(body, options);
};
