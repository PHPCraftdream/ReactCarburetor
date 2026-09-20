import { TPath, TPathSet } from "./Models.mjs";
/** The "everything changed" path: a subscriber holding it receives every update. */
export declare const WILDCARD_PATH: TPath;
export declare const joinPath: (basePath: TPath, key: string) => TPath;
export declare const pathsIntersect: (reads: TPathSet, writes: TPathSet) => boolean;
