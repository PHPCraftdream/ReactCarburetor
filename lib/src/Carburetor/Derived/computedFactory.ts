import {TComputeBody} from "@/Carburetor/Models/Derived";
import {Computed} from "./Computed";

export const computed = <R>(body: TComputeBody<R>): Computed<R> => {
    return new Computed<R>(body);
};
