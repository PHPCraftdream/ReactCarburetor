import { IComputedOptions, TComputeBody } from "../Models/Derived.mjs";
import { Computed } from "./Computed.mjs";
/**
 * Builds a memoized derived value from the body that computes it.
 *
 * @param body - runs against a tracking reader; everything it reads becomes a dependency
 * @param options - `equals` judges two results by content instead of by reference
 */
export declare const computed: <R>(body: TComputeBody<R>, options?: IComputedOptions<R>) => Computed<R>;
