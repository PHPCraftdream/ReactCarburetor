import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {keysPath} from "@/Carburetor/Store/Paths/Markers/KeysMarker";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {DIFF_PATH_THRESHOLD} from "./DiffThreshold";
import {hasSymbolDifference} from "./hasSymbolDifference";
import {sameKind} from "./sameKind";

/** Unwinds the recursive walk once the threshold trips; caught inside diffPaths, never escapes it. */
class DiffOverflow extends Error {}

/** Adds a path, aborting the whole walk once DIFF_PATH_THRESHOLD is exceeded. */
const add = (into: TPathSet, path: TPath): void => {
    into.add(path);

    if (into.size > DIFF_PATH_THRESHOLD) {
        throw new DiffOverflow();
    }
};

const walkContainer = (
    oldValue: Record<string, unknown>,
    newValue: Record<string, unknown>,
    path: TPath,
    into: TPathSet
): void => {
    if (hasSymbolDifference(oldValue, newValue)) {
        add(into, path || WILDCARD_PATH);

        return;
    }

    if (Array.isArray(oldValue)
        && (oldValue as unknown as unknown[]).length !== (newValue as unknown as unknown[]).length) {
        // Catches a length-only change a hole leaves invisible to the key-set comparison below
        // (growing via `arr.length = n` creates no own, enumerable index).
        add(into, joinPath(path, 'length'));
    }

    const oldKeys = Object.keys(oldValue);
    const newKeys = Object.keys(newValue);
    const seen = new Set<string>();
    let keysChanged = false;

    for (const key of oldKeys) {
        seen.add(key);

        if (!Object.prototype.hasOwnProperty.call(newValue, key)) {
            keysChanged = true;
            add(into, joinPath(path, key));

            continue;
        }

        walk(oldValue[key], newValue[key], joinPath(path, key), into);
    }

    for (const key of newKeys) {
        if (seen.has(key)) {
            continue;
        }

        keysChanged = true;
        add(into, joinPath(path, key));
    }

    if (keysChanged) {
        add(into, keysPath(path));
    }
};

const walk = (oldValue: unknown, newValue: unknown, path: TPath, into: TPathSet): void => {
    if (Object.is(oldValue, newValue)) {
        return;
    }

    if (!isTrackable(oldValue) || !isTrackable(newValue)) {
        add(into, path || WILDCARD_PATH);

        return;
    }

    if (!sameKind(oldValue, newValue)) {
        add(into, path || WILDCARD_PATH);

        return;
    }

    walkContainer(oldValue as Record<string, unknown>, newValue as Record<string, unknown>, path, into);
};

/**
 * The paths where `oldValue` and `newValue` differ, walking only plain objects and arrays — the
 * tracking boundary.
 *
 * Feeds `setData`'s and the write proxy's precise recording (R16-02, R16-03) instead of
 * announcing the wildcard, or the whole replaced branch, for a value that mostly stayed the same.
 *
 * - A value compared by reference (`Object.is`) that differs records its own path; the same
 *   holds when the two sides are trackable but of a different kind (array vs object), or only
 *   one side is trackable at all.
 * - A changed key set — an added or removed key, or an array's length — also records the
 *   R16-01 keys marker for that container, on top of each added/removed key's own path.
 * - A difference under a symbol key is not chased: the whole container is recorded instead.
 * - Reference-equal branches (`Object.is`) are skipped without being walked, in O(1).
 * - Past `DIFF_PATH_THRESHOLD` recorded paths, the walk gives up and reports `basePath` itself
 *   as replaced, rather than thousands of individual leaves.
 *
 * @param oldValue - the previous value, read but never mutated.
 * @param newValue - the next value, read but never mutated.
 * @param basePath - the path `oldValue`/`newValue` were found at; '' is the store root, where a
 * whole-value difference is reported as the wildcard instead of an empty path.
 */
export const diffPaths = (oldValue: unknown, newValue: unknown, basePath: TPath = ''): TPathSet => {
    const changed: TPathSet = new Set<TPath>();

    try {
        walk(oldValue, newValue, basePath, changed);
    } catch (error) {
        if (!(error instanceof DiffOverflow)) {
            throw error;
        }

        changed.clear();
        changed.add(basePath || WILDCARD_PATH);
    }

    return changed;
};
