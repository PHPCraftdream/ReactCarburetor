import {ICarburetorToken} from "../Models/Tooling";
import {getUid} from "../Store/Utils/getUid";

export const carburetorToken = <T extends unknown>(create: () => T): ICarburetorToken<T> => {
    return {id: getUid(), create};
};
