import {ICarburetorToken} from "@/Carburetor/Models/Tooling";
import {getUid} from "@/Carburetor/Store/Utils/getUid";

export const carburetorToken = <T extends unknown>(create: () => T): ICarburetorToken<T> => {
    return {id: getUid(), create};
};
