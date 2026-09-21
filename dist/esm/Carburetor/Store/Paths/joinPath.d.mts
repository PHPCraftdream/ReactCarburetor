import { TPath } from "../../Models/Paths.mjs";
/** Appends a key to a path; the root's empty base produces the key alone. */
export declare const joinPath: (basePath: TPath, key: string) => TPath;
