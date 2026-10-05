import {PATCH_ARRAY_LENGTH_LOCK, PATCH_KEY_ORDER_CHANGE, PATCH_OPAQUE, TPath, TPathSet, TPatchRecorder} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {keysPath} from "@/Carburetor/Store/Paths/Markers/KeysMarker";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
import {clonePatchValue} from "@/Carburetor/Store/Tracking/Proxy/clonePatchValue";
import {DIFF_PATH_THRESHOLD} from "./DiffThreshold";
import {keyOrderRequiresReplay} from "./Order/keyOrderRequiresReplay";
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
        segments, previousExists, previous: clonePatchValue(previous),
        nextExists, next: clonePatchValue(next),
    });
};

/**
 * Exchanges an engine view found in a freshly assigned container for its raw target, in place
 * (R32-01): a view is never reference-equal to the state member it fronts, so every leaked one
 * is visited exactly here and never reaches state. State-owned raw values hold no views and
 * are left untouched.
 *
 * @param container - the freshly assigned (caller-built) container being diffed.
 * @param key - the visited key; a string key or an array index.
 * @param value - the visited value, already found different from the previous one.
 */
const normalizeChild = (
    container: Record<string, unknown> | unknown[],
    key: string,
    value: unknown
): unknown => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const target = liveViews.readTarget(value);

    if (target === undefined) {
        return value;
    }

    (container as Record<string, unknown>)[key] = target;

    return target;
};

/** Walks one differing child pair, building its path/segments only once actually needed. */
const walkChild = (
    oldValue: unknown,
    newValue: unknown,
    path: TPath,
    key: string,
    segments: readonly string[],
    into: TPathSet,
    onPatch: TPatchRecorder | undefined
): void => {
    walk(oldValue, newValue, joinPath(path, key), onPatch ? [...segments, key] : segments, into, onPatch);
};

/** Past this length an array is probed for sparseness before the index loop commits to it. */
const SPARSE_LIMIT = 4096;
/** Evenly spread own-ness probes; a miss at any of them marks the array sparse. */
const SPARSE_PROBES = 16;

/**
 * Whether a long array looks sparse: any of a few evenly spread indices is a hole. A cheap
 * heuristic — a sparse array hiding all probes behind stored elements only loses the speedup,
 * never correctness.
 *
 * @param array - the array to probe, with `length > SPARSE_LIMIT`.
 */
const probesSparse = (array: unknown[]): boolean => {
    const last = array.length - 1;

    for (let probe = 0; probe < SPARSE_PROBES; probe++) {
        const index = Math.floor((probe * last) / (SPARSE_PROBES - 1));

        if (array[index] === undefined && !Object.prototype.hasOwnProperty.call(array, index)) {
            return true;
        }
    }

    return false;
};

/**
 * The own-index walk for a long array: only stored elements are visited, whatever `length` says.
 * Returns whether a restrictive endpoint (readonly or locked slot) was found among the new ones.
 *
 * @param oldValue - the previous array.
 * @param newValue - the next array.
 * @param path - the array's path.
 * @param segments - the array's unescaped path keys.
 * @param into - the changed-path set.
 * @param onPatch - the patch receiver, when patches were requested.
 */
const walkSparse = (
    oldValue: unknown[],
    newValue: unknown[],
    path: TPath,
    segments: readonly string[],
    into: TPathSet,
    onPatch: TPatchRecorder | undefined
): boolean => {
    const oldKeys = Object.keys(oldValue);
    const newKeys = Object.keys(newValue);
    const seen = new Set<string>(oldKeys);
    let keysChanged = false;
    let restricted = false;

    for (const key of oldKeys) {
        const previous = oldValue[key as unknown as number];

        if (!Object.prototype.hasOwnProperty.call(newValue, key)) {
            keysChanged = true;
            add(into, joinPath(path, key));
            if (onPatch) addPatch(onPatch, [...segments, key], previous, undefined, true, false);

            continue;
        }

        const raw = normalizeChild(newValue, key, newValue[key as unknown as number]);

        if (!Object.is(previous, raw)) {
            walkChild(previous, raw, path, key, segments, into, onPatch);
        }
    }

    for (const key of newKeys) {
        if (onPatch && !restricted) {
            const descriptor = Object.getOwnPropertyDescriptor(newValue, key);
            restricted = descriptor?.writable === false || descriptor?.configurable === false;
        }

        if (seen.has(key)) {
            continue;
        }

        keysChanged = true;
        const raw = normalizeChild(newValue, key, newValue[key as unknown as number]);
        add(into, joinPath(path, key));
        if (onPatch) addPatch(onPatch, [...segments, key], undefined, raw, false, true);
    }

    if (keysChanged) {
        add(into, keysPath(path));
    }

    return restricted;
};

const walkArray = (
    oldValue: unknown[],
    newValue: unknown[],
    path: TPath,
    segments: readonly string[],
    into: TPathSet,
    onPatch: TPatchRecorder | undefined
): void => {
    const changedBefore = into.size;
    let restrictedEndpoint = false;
    const oldLength = Object.getOwnPropertyDescriptor(oldValue, 'length')!;
    const newLength = Object.getOwnPropertyDescriptor(newValue, 'length')!;
    if (oldLength.value !== newLength.value || oldLength.writable !== newLength.writable) {
        // Descriptor-only locking changes the ability to write, even without changing the
        // length value. The same tracked length path announces that transition.
        add(into, joinPath(path, 'length'));
        if (oldLength.value !== newLength.value && onPatch) {
            addPatch(onPatch, [...segments, 'length'], oldLength.value, newLength.value);
        }
        if (oldLength.writable !== newLength.writable) {
            onPatch?.(PATCH_ARRAY_LENGTH_LOCK);
        }
    }

    const previousLength = oldValue.length;
    const nextLength = newValue.length;
    const limit = previousLength > nextLength ? previousLength : nextLength;

    // A long array that probes sparse is walked by own index, never by length; a dense one
    // keeps the allocation-free index loop below.
    if (limit > SPARSE_LIMIT && (probesSparse(oldValue) || probesSparse(newValue))) {
        restrictedEndpoint = walkSparse(oldValue, newValue, path, segments, into, onPatch);

        if (restrictedEndpoint && into.size > changedBefore) onPatch?.(PATCH_OPAQUE);

        return;
    }

    // Index loop: no `Object.keys` arrays, and reference-equal elements cost one `Object.is`.
    // Own-ness is only consulted where a value is `undefined` (an own `undefined` element or a
    // hole), since an array holds every defined element below `length` as an own index.
    let keysChanged = false;

    for (let index = 0; index < limit; index++) {
        const previous = oldValue[index];
        const inOld = index < previousLength
            && (previous !== undefined || Object.prototype.hasOwnProperty.call(oldValue, index));
        const next = index < nextLength ? newValue[index] : undefined;
        const inNew = index < nextLength
            && (next !== undefined || Object.prototype.hasOwnProperty.call(newValue, index));
        const name = String(index);

        if (inOld && inNew) {
            if (Object.is(previous, next)) {
                continue;
            }

            const raw = normalizeChild(newValue, name, next);

            if (Object.is(previous, raw)) {
                continue;
            }

            walkChild(previous, raw, path, name, segments, into, onPatch);
        } else if (inOld) {
            keysChanged = true;
            add(into, joinPath(path, name));
            if (onPatch) addPatch(onPatch, [...segments, name], previous, undefined, true, false);
        } else if (inNew) {
            keysChanged = true;
            if (onPatch && !restrictedEndpoint) {
                const descriptor = Object.getOwnPropertyDescriptor(newValue, index);
                restrictedEndpoint = descriptor?.writable === false || descriptor?.configurable === false;
            }
            const raw = normalizeChild(newValue, name, next);
            add(into, joinPath(path, name));
            if (onPatch) addPatch(onPatch, [...segments, name], undefined, raw, false, true);
        }
    }

    if (keysChanged) {
        add(into, keysPath(path));
    }
    // Flags alone are not state changes; a changed restrictive endpoint needs exact replay.
    if (restrictedEndpoint && into.size > changedBefore) onPatch?.(PATCH_OPAQUE);
};

const walkObject = (
    oldValue: Record<string, unknown>,
    newValue: Record<string, unknown>,
    path: TPath,
    segments: readonly string[],
    into: TPathSet,
    onPatch: TPatchRecorder | undefined
): void => {
    const changedBefore = into.size;
    let restrictedEndpoint = false;
    const oldKeys = Object.keys(oldValue);
    const newKeys = Object.keys(newValue);
    let aligned = oldKeys.length === newKeys.length;

    if (aligned) {
        for (let index = 0; index < oldKeys.length; index++) {
            if (oldKeys[index] !== newKeys[index]) {
                aligned = false;

                break;
            }
        }
    }

    // Equal entries in a different order still change enumeration. Patches lack insertion
    // positions, so inverse middle deletions and forward reorders need an owned endpoint.
    if (onPatch && !aligned && keyOrderRequiresReplay(oldKeys, newKeys)) {
        onPatch(PATCH_KEY_ORDER_CHANGE);
    }

    if (aligned) {
        for (let index = 0; index < oldKeys.length; index++) {
            const key = oldKeys[index];
            const previous = oldValue[key];
            const next = newValue[key];

            if (Object.is(previous, next)) {
                continue;
            }

            const raw = normalizeChild(newValue, key, next);

            if (Object.is(previous, raw)) {
                continue;
            }

            walkChild(previous, raw, path, key, segments, into, onPatch);
        }

        if (onPatch) {
            for (const key of newKeys) {
                if (restrictedEndpoint) {
                    break;
                }

                const descriptor = Object.getOwnPropertyDescriptor(newValue, key);
                restrictedEndpoint = descriptor?.writable === false || descriptor?.configurable === false;
            }
        }
    } else {
        const seen = new Set<string>(oldKeys);

        for (const key of oldKeys) {
            if (!Object.prototype.hasOwnProperty.call(newValue, key)) {
                add(into, joinPath(path, key));
                if (onPatch) addPatch(onPatch, [...segments, key], oldValue[key], undefined, true, false);

                continue;
            }

            const previous = oldValue[key];
            const raw = normalizeChild(newValue, key, newValue[key]);

            if (Object.is(previous, raw)) {
                continue;
            }

            walkChild(previous, raw, path, key, segments, into, onPatch);
        }

        for (const key of newKeys) {
            if (onPatch && !restrictedEndpoint) {
                const descriptor = Object.getOwnPropertyDescriptor(newValue, key);
                restrictedEndpoint = descriptor?.writable === false || descriptor?.configurable === false;
            }
            if (seen.has(key)) {
                continue;
            }

            const raw = normalizeChild(newValue, key, newValue[key]);
            add(into, joinPath(path, key));
            if (onPatch) addPatch(onPatch, [...segments, key], undefined, raw, false, true);
        }
    }

    if (!aligned) {
        add(into, keysPath(path));
    }
    // Flags alone are not state changes; a changed restrictive endpoint needs exact replay.
    if (restrictedEndpoint && into.size > changedBefore) onPatch?.(PATCH_OPAQUE);
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

    if (Array.isArray(oldValue)) {
        walkArray(
            oldValue as unknown as unknown[], newValue as unknown as unknown[], path, segments, into, onPatch
        );
    } else {
        walkObject(
            oldValue as Record<string, unknown>, newValue as Record<string, unknown>, path, segments, into, onPatch
        );
    }
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
 * - An engine view found in `newValue` is exchanged for its raw target in place (R32-01) before
 *   the comparison, so a container built from draft branches never stores a view.
 * - A changed ordered own-key sequence also records the keys marker, even when every entry
 *   has the same value; leaf readers stay asleep.
 * - Reference-equal branches (`Object.is`) are skipped without being walked, in O(1), before
 *   any path, segment or key list is built for them.
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
 * @param onPatch - either a receiver for immediate delivery, or a bounded collection whose
 *   delivery the caller defers until all effective paths have been recorded.
 */
export const diffPaths = (
    oldValue: unknown,
    newValue: unknown,
    basePath: TPath = '',
    baseSegments: readonly string[] = [],
    onPatch?: TPatchRecorder | Array<Parameters<TPatchRecorder>[0]>
): TPathSet => {
    const changed: TPathSet = new Set<TPath>();
    const pending = Array.isArray(onPatch) ? onPatch : undefined;
    const deliver: TPatchRecorder | undefined = pending
        ? patch => { pending.push(patch); }
        : onPatch as TPatchRecorder | undefined;

    // A caller-asigned root is unwrapped like any assigned value (R32-01): a view is never
    // equal to the state member it fronts, so the walk below sees the raw branch from here on.
    if (newValue !== null && typeof newValue === 'object') {
        newValue = liveViews.readTarget(newValue) ?? newValue;
    }

    try {
        walk(oldValue, newValue, basePath, baseSegments, changed, deliver);
    } catch (error) {
        if (!(error instanceof DiffOverflow)) {
            throw error;
        }
        // A threshold fallback replaces the entire partial diff: none of its earlier patches
        // may leak to a history (nor interrupt the complete path attribution).
        if (pending) pending.length = 0;

        changed.clear();
        changed.add(basePath || WILDCARD_PATH);
        // The aborted walk left part of `newValue` unvisited: exchange its remaining views too.
        liveViews.normalizeAssigned(newValue, oldValue);
        addPatch(deliver, baseSegments, oldValue, newValue);
    }

    return changed;
};
