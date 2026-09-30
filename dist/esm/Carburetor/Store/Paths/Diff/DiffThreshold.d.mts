/**
 * Past this many recorded (`diffPaths`) or applied (`applyDiff`) differences, the walk gives up
 * and treats the whole subtree as replaced, instead of naming thousands of individual leaves —
 * bounding the cost of a near-total change, where a per-leaf answer would cost more than it saves.
 */
export declare const DIFF_PATH_THRESHOLD = 2000;
