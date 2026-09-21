import {TComputeBody} from "@/Carburetor/Models/Derived";
import {Computed} from "./Computed";

/** Builds a memoized derived value from the body that computes it. */
export const computed = <R>(body: TComputeBody<R>): Computed<R> => {
    return new Computed<R>(body);
};
