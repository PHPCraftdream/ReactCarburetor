import {TPath} from "../../../../../Models/Paths";
import {isPlainObject} from "../../../../../Component/Connection/isPlainObject";
import {liveViews} from "../../../../Tracking/Proxy/liveViews";
import {CARBURETOR_TARGETS_SINCE, IInternalSubscriptionProtocol} from "../../../Models";
import {planStructure} from "../Plan/planStructure";
import {AddedMembers} from "./AddedMembers";
import {patchArrayStructure} from "./patchArrayStructure";
import {patchKeyedStructure} from "./patchKeyedStructure";

/**
 * Patches a structural change of the selected container itself — an append or tail truncation of
 * an array, keys added to or deleted from a plain object — without walking the members that stayed.
 *
 * The proof is the copy ledger and the raw mutation targets: the snapshot's root must be the
 * ledger's copy of the live root's raw object, and every write inside the selection must be a
 * direct key of that root whose only mutated raw object is the root itself. Every member container
 * is ledger-registered and none was a target, so none changed in place: each kept member's copy is
 * exactly what the full reconcile would return for it. Added members are detached fresh and must
 * not overlap the previous snapshot; anything else answers undefined, for the full reconcile. The
 * caller has already proven its outside-root writes and that the snapshot is a tree.
 *
 * @param source - store providing its write log
 * @param baselineVersion - version represented by previous
 * @param rootPath - the path of the selected view
 * @param paths - the paths written since the baseline
 * @param previous - prior detached value
 * @param live - same live view represented by previous
 * @param ledger - raw-object to detached-copy ownership ledger, updated in place on success
 * @param onLiveInstance - owner policy for live class instances
 * @param onArraySubclass - optional array-subclass policy
 * @returns the new snapshot, the previous one when nothing changed, or undefined
 */
export const patchStructure = <R>(
    source: object, baselineVersion: number, rootPath: TPath, paths: ReadonlyArray<TPath>, previous: R,
    live: object, ledger: WeakMap<object, unknown>, onLiveInstance: ((instance: object) => void) | undefined,
    onArraySubclass?: (instance: object) => never
): R | undefined => {
    const raw = liveViews.readTarget(live);
    if (raw === undefined || ledger.get(raw) !== previous || previous === null || typeof previous !== 'object') {
        return undefined;
    }
    const written = (source as IInternalSubscriptionProtocol)[CARBURETOR_TARGETS_SINCE]?.call(source, baselineVersion);
    if (written === undefined) return undefined;
    const keys = planStructure(rootPath, paths, written, raw);
    if (keys === undefined) return undefined;
    const added = new AddedMembers(ledger, onLiveInstance, onArraySubclass);
    const prototype = Object.getPrototypeOf(raw) as object | null;
    let result: unknown;
    if (Array.isArray(raw)) {
        if (prototype !== Array.prototype || !Array.isArray(previous)
            || Object.getPrototypeOf(previous) !== Array.prototype) return undefined;
        result = patchArrayStructure(previous, live as unknown[], raw, keys, added);
    } else if (isPlainObject(raw) && isPlainObject(previous) && Object.getPrototypeOf(previous) === prototype) {
        result = patchKeyedStructure(previous, live, raw, keys, added);
    } else return undefined;
    if (result === undefined || result === previous) return result as R | undefined;
    if (!added.commit()) return undefined;
    ledger.set(live, result);
    ledger.set(raw, result);
    return result as R;
};
