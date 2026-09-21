import {TPath} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "./PathSeparator";

/** Appends a key to a path; the root's empty base produces the key alone. */
export const joinPath = (basePath: TPath, key: string): TPath => {
    return basePath ? basePath + PATH_SEPARATOR + key : key;
};
