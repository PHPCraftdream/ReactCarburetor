import {TPath} from "@/Carburetor/Models/Paths";

/**
 * Whether two closed read sets hold the same paths.
 *
 * The identity check first: the store's O(1) drift answer keys on the very Set it filed, so
 * callers that kept a previously filed set short-circuit here without walking the paths.
 *
 * @param a - one read set
 * @param b - the other read set
 */
export const sameReads = (a: ReadonlySet<TPath>, b: ReadonlySet<TPath>): boolean => {
    if (a === b) {
        return true;
    }

    if (a.size !== b.size) {
        return false;
    }

    for (const path of a) {
        if (!b.has(path)) {
            return false;
        }
    }

    return true;
};
