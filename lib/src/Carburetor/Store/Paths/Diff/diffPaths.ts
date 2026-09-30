import {PATCH_ABSENT, TPath, TPathSet, TPatchRecorder} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {keysPath} from "@/Carburetor/Store/Paths/Markers/KeysMarker";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";
import {DIFF_PATH_THRESHOLD} from "./DiffThreshold";
import {sameKind} from "./sameKind";

/** Unwinds the recursive walk once the threshold trips; caught inside diffPaths, never escapes it. */
class DiffOverflow extends Error {}

/** A plain value safe to hand a patch listener: cloned so a later in-place write cannot alias it. */
const patchValue = (value: unknown): unknown => (isTrackable(value) ? deepClone(value) : value);

/** Adds a path, aborting the whole walk once DIFF_PATH_THRESHOLD is exceeded. */
const add = (into: TPathSet, path: TPath): void => {
    into.add(path);

    if (into.size > DIFF_PATH_THRESHOLD) {
        throw new DiffOverflow();
    }
};

/** Reports one leaf-level patch, when a caller asked diffPaths for patches at all. */
const addPatch = (
    onPatch: TPatchRecorder | undefined,
    segments: readonly string[],
    previous: unknown,
    next: unknown
): void => {
    onPatch?.({segments, previous: patchValue(previous), next: patchValue(next)});
};

const walkContainer = (
    oldValue: Record<string, unknown>,
    newValue: Record<string, unknown>,
    path: TPath,
    segments: readonly string[],
    into: TPathSet,
    onPatch: TPatchRecorder | undefined
): void => {
    if (Array.isArray(oldValue)
        && (oldValue as unknown as unknown[]).length !== (newValue as unknown as unknown[]).length) {
        // Catches a length-only change a hole leaves invisible to the key-set comparison below
        // (growing via `arr.length = n` creates no own, enumerable index).
        add(into, joinPath(path, 'length'));
        addPatch(
            onPatch,
            [...segments, 'length'],
            (oldValue as unknown as unknown[]).length,
            (newValue as unknown as unknown[]).length
        );
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
            addPatch(onPatch, [...segments, key], oldValue[key], PATCH_ABSENT);

            continue;
        }

        walk(oldValue[key], newValue[key], joinPath(path, key), [...segments, key], into, onPatch);
    }

    for (const key of newKeys) {
        if (seen.has(key)) {
            continue;
        }

        keysChanged = true;
        add(into, joinPath(path, key));
        addPatch(onPatch, [...segments, key], PATCH_ABSENT, newValue[key]);
    }

    if (keysChanged) {
        add(into, keysPath(path));
    }
};

const walk = (
    oldValue: unknown,
    newValue: unknown,
    path: TPath,
    segments: readonly string[],
    into: TPathSet,
    onPatch: TPatchRecorder | undefined
): void => {
    if (Object.is(oldValue, newValue)) {
        return;
    }

    if (!isTrackable(oldValue) || !isTrackable(newValue)) {
        add(into, path || WILDCARD_PATH);
        addPatch(onPatch, segments, oldValue, newValue);

        return;
    }

    if (!sameKind(oldValue, newValue)) {
        add(into, path || WILDCARD_PATH);
        addPatch(onPatch, segments, oldValue, newValue);

        return;
    }

    walkContainer(
        oldValue as Record<string, unknown>, newValue as Record<string, unknown>, path, segments, into, onPatch
    );
};

/**
 * The paths where `oldValue` and `newValue` differ, walking only plain objects and arrays — the
 * tracking boundary.
 *
 * Feeds `setData`'s and the write proxy's precise recording (R16-02, R16-03) instead of
 * announcing the wildcard, or the whole replaced branch, for a value that mostly stayed the same.
 *
 * - A value compared by reference (`Object.is`) that differs records its own path; the same
 *   holds when trackable sides differ in kind (array vs object, or ordinary vs null-prototype
 *   containers), or only one side is trackable at all.
 * - A changed key set — an added or removed key, or an array's length — also records the
 *   R16-01 keys marker for that container, on top of each added/removed key's own path.
 * - Reference-equal branches (`Object.is`) are skipped without being walked, in O(1).
 * - Past `DIFF_PATH_THRESHOLD` recorded paths, the walk gives up and reports `basePath` itself
 *   as replaced, rather than thousands of individual leaves.
 * - When `onPatch` is given, every leaf this walk records is also reported to it as a patch
 *   (R16-07), `baseSegments` extended one key at a time; the keys-marker path never is, since
 *   inverting the leaf patches already restores the key set. The threshold fallback still reports
 *   one patch for the whole `basePath`/`baseSegments` branch, so the change stays invertible.
 *
 * @param oldValue - the previous value, read but never mutated.
 * @param newValue - the next value, read but never mutated.
 * @param basePath - the path `oldValue`/`newValue` were found at; '' is the store root, where a
 * whole-value difference is reported as the wildcard instead of an empty path.
 * @param baseSegments - `basePath`'s own keys, unescaped; only used to build patches for `onPatch`.
 * @param onPatch - receives one patch per leaf this walk records, when a patch listener is attached.
 */
export const diffPaths = (
    oldValue: unknown,
    newValue: unknown,
    basePath: TPath = '',
    baseSegments: readonly string[] = [],
    onPatch?: TPatchRecorder
): TPathSet => {
    const changed: TPathSet = new Set<TPath>();

    try {
        walk(oldValue, newValue, basePath, baseSegments, changed, onPatch);
    } catch (error) {
        if (!(error instanceof DiffOverflow)) {
            throw error;
        }

        changed.clear();
        changed.add(basePath || WILDCARD_PATH);
        addPatch(onPatch, baseSegments, oldValue, newValue);
    }

    return changed;
};
