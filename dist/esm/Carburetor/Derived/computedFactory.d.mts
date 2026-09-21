import { TComputeBody } from "../Models/Derived.mjs";
import { Computed } from "./Computed.mjs";
/** Builds a memoized derived value from the body that computes it. */
export declare const computed: <R>(body: TComputeBody<R>) => Computed<R>;
