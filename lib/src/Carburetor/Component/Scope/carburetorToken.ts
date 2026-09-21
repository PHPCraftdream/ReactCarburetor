import {ICarburetorToken} from "@/Carburetor/Models/Tooling";
import {getUid} from "@/Carburetor/Store/Utils/getUid";

/** A key a scope creates one instance per, carrying the factory that makes it. */
export const carburetorToken = <T extends unknown>(create: () => T): ICarburetorToken<T> => {
    return {id: getUid(), create};
};
