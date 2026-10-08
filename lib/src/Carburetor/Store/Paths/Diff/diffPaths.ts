import {PATCH_KEY_ORDER_CHANGE, PATCH_OPAQUE, TPath, TPathSet, TPatchRecorder} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {keysPath} from "@/Carburetor/Store/Paths/Markers/KeysMarker";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
import {clonePatchValue} from "@/Carburetor/Store/Tracking/Proxy/clonePatchValue";
import {DIFF_PATH_THRESHOLD} from "./Threshold/DIFF_PATH_THRESHOLD";
import {shouldCollapseDiff} from "./Threshold/shouldCollapseDiff";
import {keyOrderRequiresReplay} from "./Order/keyOrderRequiresReplay";
import {sameKind} from "./Kinds/sameKind";
import {walkIdentityArray} from "./Kinds/walkIdentityArray";
import {countDiffLeaves} from "./Threshold/countDiffLeaves";

class DiffOverflow extends Error {}

/** The recorded-path ceiling of one walk; lifted for the precise re-walk of a partial change. */
interface IDiffBudget {
    limit: number;
    spent: number;
}


const add = (into: TPathSet, path: TPath, budget: IDiffBudget): void => {
    if (!into.has(path)) budget.spent++;
    into.add(path);
    if (budget.spent > budget.limit) throw new DiffOverflow();
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
    onPatch: TPatchRecorder | undefined,
    budget: IDiffBudget
): void => {
    walk(oldValue, newValue, joinPath(path, key), onPatch ? [...segments, key] : segments, into, onPatch, budget);
};

const walkObject = (
    oldValue: Record<string, unknown>,
    newValue: Record<string, unknown>,
    path: TPath,
    segments: readonly string[],
    into: TPathSet,
    onPatch: TPatchRecorder | undefined,
    budget: IDiffBudget
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

            walkChild(previous, raw, path, key, segments, into, onPatch, budget);
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
                add(into, joinPath(path, key), budget);
                if (onPatch) addPatch(onPatch, [...segments, key], oldValue[key], undefined, true, false);

                continue;
            }

            const previous = oldValue[key];
            const raw = normalizeChild(newValue, key, newValue[key]);

            if (Object.is(previous, raw)) {
                continue;
            }

            walkChild(previous, raw, path, key, segments, into, onPatch, budget);
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
            add(into, joinPath(path, key), budget);
            if (onPatch) addPatch(onPatch, [...segments, key], undefined, raw, false, true);
        }
    }

    if (!aligned) {
        add(into, keysPath(path), budget);
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
    onPatch: TPatchRecorder | undefined,
    budget: IDiffBudget
): void => {
    if (Object.is(oldValue, newValue)) {
        return;
    }

    if (!isTrackable(oldValue) || !isTrackable(newValue)) {
        add(into, path || WILDCARD_PATH, budget);
        addPatch(onPatch, segments, oldValue, newValue);

        return;
    }

    if (!sameKind(oldValue, newValue)) {
        add(into, path || WILDCARD_PATH, budget);
        addPatch(onPatch, segments, oldValue, newValue);

        return;
    }

    if (Array.isArray(oldValue)) {
        walkIdentityArray(oldValue as unknown[], newValue as unknown[], path, segments, into, onPatch, {
            add: written => add(into, written, budget),
            child: (previous, next, key, recorder) =>
                walkChild(previous, next, path, key, segments, into, recorder, budget),
        });
    } else {
        walkObject(
            oldValue as Record<string, unknown>, newValue as Record<string, unknown>,
            path, segments, into, onPatch, budget
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
    const budget: IDiffBudget = {limit: DIFF_PATH_THRESHOLD, spent: 0};
    const pending = onPatch === undefined ? undefined : Array.isArray(onPatch) ? onPatch : [];
    const deliver: TPatchRecorder | undefined = pending
        ? patch => { pending.push(patch); }
        : undefined;

    // A caller-asigned root is unwrapped like any assigned value (R32-01): a view is never
    // equal to the state member it fronts, so the walk below sees the raw branch from here on.
    if (newValue !== null && typeof newValue === 'object') {
        newValue = liveViews.readTarget(newValue) ?? newValue;
    }

    try {
        walk(oldValue, newValue, basePath, baseSegments, changed, deliver, budget);
    } catch (error) {
        if (!(error instanceof DiffOverflow)) {
            throw error;
        }
        // A threshold fallback replaces the entire partial diff: none of its earlier patches
        // may leak to a history (nor interrupt the complete path attribution).
        if (pending) pending.length = 0;

        changed.clear();
        // The aborted walk left part of `newValue` unvisited: exchange its remaining views too,
        // which also makes the counting walks below safe to run over it.
        liveViews.normalizeAssigned(newValue, oldValue);

        // R36-05: past the floor the answer is relative. A partial change of a large branch stays
        // precise (nothing is delivered yet that the re-walk would repeat); a near-total one collapses.
        if (!shouldCollapseDiff(
            countDiffLeaves.changed(oldValue, newValue), countDiffLeaves.total(oldValue, newValue)
        )) {
            budget.limit = Infinity;
            budget.spent = 0;
            walk(oldValue, newValue, basePath, baseSegments, changed, deliver, budget);

            if (typeof onPatch === 'function') pending?.forEach(onPatch);
            return changed;
        }

        if (basePath === '' && isTrackable(oldValue) && isTrackable(newValue) && sameKind(oldValue, newValue)) {
            // A same-kind root never collapses to the wildcard: only the differing top-level keys wake.
            const oldRoot = oldValue as Record<string, unknown>;
            const newRoot = newValue as Record<string, unknown>;
            const oldKeys = Object.keys(oldRoot);
            const newKeys = Object.keys(newRoot);
            const keysChanged = oldKeys.length !== newKeys.length
                || oldKeys.some((key, index) => key !== newKeys[index]);
            for (const key of new Set([...oldKeys, ...newKeys])) {
                if (countDiffLeaves.changed(oldRoot[key], newRoot[key], true) > 0) changed.add(joinPath('', key));
            }
            if (keysChanged) changed.add(keysPath(''));
            addPatch(deliver, baseSegments, oldValue, newValue);

            if (typeof onPatch === 'function') pending?.forEach(onPatch);
            return changed;
        }
        changed.add(basePath || WILDCARD_PATH);
        addPatch(deliver, baseSegments, oldValue, newValue);
    }

    if (typeof onPatch === 'function') pending?.forEach(onPatch);
    return changed;
};
