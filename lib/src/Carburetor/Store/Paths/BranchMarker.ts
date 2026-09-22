import {TPath} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "./PathSeparator";

/** The synthetic key standing in for "the branch itself was read, no leaf under it". */
const BRANCH_MARKER = '~p';

/**
 * The path a presence or truthiness check on a branch subscribes by: `!!data.user` reads
 * `user` but no leaf, and would otherwise record nothing — replacing the branch then changes
 * what the component renders while nobody is told.
 *
 * The marker is an ordinary segment below the branch, so a write at or above the branch wakes
 * its readers through the usual ancestor matching, while a write strictly below — a leaf under
 * an intact branch — does not. `~p` cannot collide with real data: joinPath escapes `~` to
 * `~0` and the separator to `~1`, so no escaped key can contain a `~` followed by a letter.
 */
export const branchPath = (path: TPath): TPath => {
    return path + PATH_SEPARATOR + BRANCH_MARKER;
};
