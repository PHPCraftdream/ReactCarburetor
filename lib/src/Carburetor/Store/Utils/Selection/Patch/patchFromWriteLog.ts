import {VIEW_PATH} from "@/Carburetor/Store/Tracking/Models";
import {CARBURETOR_PATHS_SINCE, IInternalSubscriptionProtocol} from "@/Carburetor/Store/Utils/Models";
import {patchSelection} from "./patchSelection";
import {planSelectionPatch} from "./planSelectionPatch";

/**
 * Approximate whole-reconcile cost for the work budget: the selection's shallow size. The root
 * spine copy is O(length) anyway, so length/size/key-count dominates the honest comparison.
 */
const shallowSize = (value: unknown): number => {
    if (Array.isArray(value)) return value.length;
    if (value instanceof Map || value instanceof Set) return value.size;
    if (value !== null && typeof value === 'object') return Object.keys(value).length;
    return 0;
};

/**
 * R36-01: brings a snapshot up to date from the store's write log instead of walking the whole
 * selection. Only a selection that is one live view qualifies; the changed paths come from the
 * log, so the cost follows the writes, not the selection.
 *
 * R37-04: whether to patch at all is a
 * relative decision — estimated patch work against the previous snapshot's shallow size — so a
 * 65-leaf batch on a large list patches like a 64-leaf one, while a dense batch takes the full
 * reconcile honestly.
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
    const plan = planSelectionPatch(rootPath, paths, shallowSize(previous));
    return plan === undefined
        ? undefined
        : patchSelection(previous, live, plan, ledger, onLiveInstance, onArraySubclass);
};
