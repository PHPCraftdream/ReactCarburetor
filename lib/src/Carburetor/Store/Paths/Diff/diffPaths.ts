import {PATCH_ARRAY_LENGTH_LOCK, PATCH_KEY_ORDER_CHANGE, TPath, TPathSet, TPatchRecorder} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {keysPath} from "@/Carburetor/Store/Paths/Markers/KeysMarker";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";
import {DIFF_PATH_THRESHOLD} from "./DiffThreshold";
import {keyOrderRequiresReplay} from "./Order/keyOrderRequiresReplay";
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
    next: unknown,
    previousExists = true,
    nextExists = true
): void => {
    onPatch?.({
        segments, previousExists, previous: patchValue(previous),
        nextExists, next: patchValue(next),
    });
};

const walkContainer = (
    oldValue: Record<string, unknown>,
    newValue: Record<string, unknown>,
    path: TPath,
    segments: readonly string[],
    into: TPathSet,
    onPatch: TPatchRecorder | undefined
): void => {
    if (Array.isArray(oldValue)) {
        const oldLength = Object.getOwnPropertyDescriptor(oldValue, 'length')!;
        const newLength = Object.getOwnPropertyDescriptor(newValue, 'length')!;
        if (oldLength.value !== newLength.value || oldLength.writable !== newLength.writable) {
            // Descriptor-only locking changes the ability to write, even without changing the
            // length value. The same tracked length path announces that transition.
            add(into, joinPath(path, 'length'));
            if (oldLength.value !== newLength.value) {
                addPatch(onPatch, [...segments, 'length'], oldLength.value, newLength.value);
            }
            if (oldLength.writable !== newLength.writable) {
                onPatch?.(PATCH_ARRAY_LENGTH_LOCK);
            }
        }
    }

    const oldKeys = Object.keys(oldValue);
    const newKeys = Object.keys(newValue);
    const seen = new Set<string>();
    let keysChanged = oldKeys.length !== newKeys.length;
    if (!keysChanged) {
        for (let index = 0; index < oldKeys.length; index++) {
            if (oldKeys[index] !== newKeys[index]) {
                keysChanged = true;
                break;
            }
        }
    }
    // Equal entries in a different order still change enumeration. Patches lack insertion
    // positions, so inverse middle deletions and forward reorders need an owned endpoint.
    // Supported arrays only have numeric own keys; their index writes do not require replay.
    if (onPatch && keysChanged && !Array.isArray(oldValue)
        && keyOrderRequiresReplay(oldKeys, newKeys)) {
        onPatch(PATCH_KEY_ORDER_CHANGE);
    }

    for (const key of oldKeys) {
        seen.add(key);

        if (!Object.prototype.hasOwnProperty.call(newValue, key)) {
            keysChanged = true;
            add(into, joinPath(path, key));
            addPatch(onPatch, [...segments, key], oldValue[key], undefined, true, false);

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
        addPatch(onPatch, [...segments, key], undefined, newValue[key], false, true);
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
 * - A changed ordered own-key sequence also records the keys marker, even when every entry
 *   has the same value; leaf readers stay asleep.
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
