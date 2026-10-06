import {DIFF_PATH_THRESHOLD} from "@/Carburetor/Store/Paths/Diff/Threshold/DIFF_PATH_THRESHOLD";

/**
 * Returns whether a large diff should collapse to its fallback path.
 *
 * @param changed - number of differing paths.
 * @param visited - number of visited paths.
 */
export const shouldCollapseDiff = (changed: number, visited: number): boolean =>
    changed > DIFF_PATH_THRESHOLD && changed > visited / 2;
