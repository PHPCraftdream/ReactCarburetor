import { TPathSet } from "../../Models/Paths.mjs";
/**
 * Whether any written path touches any read path; a wildcard on either side matches all.
 *
 * @param reads - the paths subscribers watched; a wildcard entry answers true outright.
 * @param writes - the paths a transaction changed; each is paired against every read
 * until one touches.
 */
export declare const pathsIntersect: (reads: TPathSet, writes: TPathSet) => boolean;
