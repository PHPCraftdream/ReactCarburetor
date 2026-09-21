import { TComputeBody } from "../Models/Derived.js";
import { Computed } from "./Computed.js";
/** Builds a memoized derived value from the body that computes it. */
export declare const computed: <R>(body: TComputeBody<R>) => Computed<R>;
