import { TPathSet } from "../../Models/Paths.js";
/** Whether any written path touches any read path; a wildcard on either side matches all. */
export declare const pathsIntersect: (reads: TPathSet, writes: TPathSet) => boolean;
