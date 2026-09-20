import {TPath} from "../../Models/Paths";
import {PATH_SEPARATOR} from "./PathSeparator";

export const joinPath = (basePath: TPath, key: string): TPath => {
    return basePath ? basePath + PATH_SEPARATOR + key : key;
};
