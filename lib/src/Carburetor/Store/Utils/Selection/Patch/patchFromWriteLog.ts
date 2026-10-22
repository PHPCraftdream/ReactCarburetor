import {RAW_EXPOSURE, TPath} from "../../../../Models/Paths";
import {VIEW_PATH} from "../../../Tracking/Models";
import {
    CARBURETOR_PATHS_SINCE, CARBURETOR_TARGETS_SINCE, IInternalSubscriptionProtocol,
} from "../../Models";
import {PATH_SEPARATOR} from "../../../Paths/PathSeparator";
import {WILDCARD_PATH} from "../../../Paths/WildcardPath";
import {patchSelection} from "./patchSelection";
import {planSelectionPatch} from "./Plan/planSelectionPatch";
import {patchStructure} from "./Structure/patchStructure";

/** Approximate whole-reconcile cost for the write-log patch budget. */
const shallowSize = (value: unknown): number => {
    if (Array.isArray(value)) return value.length;
    if (value instanceof Map || value instanceof Set) return value.size;
    if (value !== null && typeof value === 'object') return Object.keys(value).length;
    return 0;
};

/**
 * Reuses or patches a completed snapshot from a complete write log.
 *
 * The ownership proof is the mutation targets: every raw object included by detach is registered
 * in the copy ledger, and the write log records the raw object each written path actually
 * mutated, so a write is only provably disjoint when none of its targets is ledger-registered —
 * without walking the selected graph again. A tick-only publication's target is the store root,
 * which is never ledger-registered, so the fast path stays. A key-set or length change of the
 * selected container itself is patched by `patchStructure` from the same proof.
 *
 * @param source - store providing its write log
 * @param baselineVersion - version represented by previous
 * @param previous - prior detached value
 * @param live - same live view represented by previous
 * @param ledger - raw-object to detached-copy ownership ledger
 * @param onLiveInstance - owner policy for live class instances
 * @param onArraySubclass - optional array-subclass policy
 * @param allowPatch - whether shared graphs permit partial patching
 */
export const patchFromWriteLog = <R>(
    source: object, baselineVersion: number, previous: R, live: unknown,
    ledger: WeakMap<object, unknown>, onLiveInstance: ((instance: object) => void) | undefined,
    onArraySubclass?: (instance: object) => never,
    allowPatch = true
): R | undefined => {
    const protocol = source as IInternalSubscriptionProtocol;
    const pathsSince = protocol[CARBURETOR_PATHS_SINCE];
    if (pathsSince === undefined || live === null || typeof live !== 'object')
        return undefined;
    const rootPath = (live as {[VIEW_PATH]?: unknown})[VIEW_PATH];
    if (typeof rootPath !== 'string') return undefined;
    const paths = pathsSince.call(source, baselineVersion);
    if (paths === undefined) return undefined;
    const rootPrefix = rootPath + PATH_SEPARATOR;
    const outsidePaths: TPath[] = [];
    let hasInside = false;
    for (const path of paths) {
        if (path === WILDCARD_PATH) return undefined;
        const inside = rootPath === '' || path === rootPath || path.startsWith(rootPrefix);
        if (inside) hasInside = true;
        else outsidePaths.push(path);
    }
    // Outside-only writes need no patch budget, but the planner must still reject ancestors.
    const plan = planSelectionPatch(rootPath, paths, hasInside ? shallowSize(previous) : 0);
    // A structural change of the root has its own proof below. It needs a tree snapshot and an
    // owner instance policy (each one throws): the full walk never reuses an instance's ancestor.
    if (plan === undefined && (!allowPatch || onLiveInstance === undefined)) return undefined;

    // The raw-target proof applies to outside-root writes here (the structural route proves its
    // own inside-root writes): inside-root changed leaves keep the existing patch route
    // (`patchSelection` refuses any object-valued changed leaf, so coarse native paths cannot
    // become an unsafe partial patch), and a publication whose raw proof was dropped keeps
    // patching complete ordinary inside-root paths. For outside-root writes, a write is provably
    // disjoint only when nothing it mutated is in the snapshot's copy ledger: the log records the
    // raw object each write actually mutated — the set trap's container, the walked replacement
    // branch, or the coarse native field value. Exposure of raw native members marks the write
    // unknown — exact targets cannot be known for effects reached through them — so reuse is
    // refused. A write whose targets were not recorded is unknown and stays conservative.
    if (outsidePaths.length > 0) {
        const targets = protocol[CARBURETOR_TARGETS_SINCE];
        if (targets === undefined) return undefined;
        const written = targets.call(source, baselineVersion);
        if (written === undefined) return undefined;
        for (const path of outsidePaths) {
            const mutated = written.get(path);
            if (mutated === undefined) return undefined;
            for (const raw of mutated) {
                if (raw === RAW_EXPOSURE || ledger.has(raw)) return undefined;
            }
        }
    }
    if (plan === undefined) {
        return patchStructure(
            source, baselineVersion, rootPath, paths, previous, live, ledger, onLiveInstance, onArraySubclass
        );
    }
    if (plan.children === undefined) return previous;
    if (!allowPatch) return undefined;
    return patchSelection(previous, live, plan, ledger, onLiveInstance, onArraySubclass);
};
