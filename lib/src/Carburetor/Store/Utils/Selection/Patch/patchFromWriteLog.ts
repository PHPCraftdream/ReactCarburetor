import {VIEW_PATH} from "@/Carburetor/Store/Tracking/Models";
import {CARBURETOR_PATHS_SINCE, IInternalSubscriptionProtocol} from "@/Carburetor/Store/Utils/Models";
import {patchSelection} from "./patchSelection";
import {planSelectionPatch} from "./planSelectionPatch";

/**
 * R36-01: brings a snapshot up to date from the store's write log instead of walking the whole
 * selection. Only a selection that is one live view qualifies; the changed paths come from the
 * log, so the cost follows the writes, not the selection.
 *
 * @param source - the store the selection reads
 * @param baselineVersion - the store version the snapshot was valid at
 * @param previous - the previous snapshot
 * @param live - the selector's result: the same live view as when the snapshot was built
 * @param ledger - the previous pass's raw to copy ledger, updated in place on success
 * @param onLiveInstance - the owner's policy for a class instance met in a changed subtree
 * @param onArraySubclass - the owner's policy for an array subclass met in a changed subtree
 * @returns the new snapshot, or undefined when the full reconcile must run
 */
export const patchFromWriteLog = <R>(
    source: object, baselineVersion: number, previous: R, live: unknown,
    ledger: WeakMap<object, unknown>, onLiveInstance: ((instance: object) => void) | undefined,
    onArraySubclass?: (instance: object) => never
): R | undefined => {
    const pathsSince = (source as IInternalSubscriptionProtocol)[CARBURETOR_PATHS_SINCE];
    if (pathsSince === undefined || live === null || typeof live !== 'object') return undefined;
    const rootPath = (live as {[VIEW_PATH]?: unknown})[VIEW_PATH];
    if (typeof rootPath !== 'string') return undefined;
    const paths = pathsSince.call(source, baselineVersion);
    if (paths === undefined) return undefined;
    const plan = planSelectionPatch(rootPath, paths);
    return plan === undefined
        ? undefined
        : patchSelection(previous, live, plan, ledger, onLiveInstance, onArraySubclass);
};
