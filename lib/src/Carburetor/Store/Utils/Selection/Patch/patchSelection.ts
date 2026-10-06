import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
import {reconcileSelection} from "@/Carburetor/Store/Utils/Selection/reconcileSelection";
import {IPatchNode} from "./Models";

/** Raised inside a patch that meets a shape it cannot patch exactly; never escapes patchSelection. */
class PatchFallback extends Error {}

const hasOwn = Object.prototype.hasOwnProperty;

const isPlainSpine = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === Array.prototype || prototype === null;
};

const cloneSpine = (value: Record<string, unknown>): Record<string, unknown> =>
    Array.isArray(value)
        ? (value as unknown[]).slice() as unknown as Record<string, unknown>
        : Object.assign(Object.create(Object.getPrototypeOf(value)), value) as Record<string, unknown>;

/**
 * Brings a snapshot up to date by reconciling only the changed subtrees of the live selection.
 *
 * The spine from the root to each changed key is copied (copy-on-write); every other child keeps
 * its previous reference. Each changed subtree goes through `reconcileSelection`, so what it
 * returns is exactly what the full walk returns for that subtree. The ledger gains the new spine
 * copies only when the whole patch succeeds. Reads through `live` are recorded by the caller's
 * recorder, so a leaf new to the selection joins the read set.
 *
 * @param previous - the previous snapshot of this selection
 * @param live - the live view the snapshot mirrors, the same object as last time
 * @param plan - the changed keys, from planSelectionPatch
 * @param ledger - the raw to copy ledger of the previous pass, updated in place on success
 * @param onLiveInstance - the owner's policy for a class instance met in a changed subtree
 * @param onArraySubclass - the owner's policy for an array subclass met in a changed subtree
 * @returns the new snapshot (the previous one itself when nothing in it changed), or undefined when
 *   the full reconcile must run
 */
export const patchSelection = <R>(
    previous: R, live: unknown, plan: IPatchNode, ledger: WeakMap<object, unknown>,
    onLiveInstance: ((instance: object) => void) | undefined,
    onArraySubclass?: (instance: object) => never
): R | undefined => {
    const filed: Array<[object, unknown]> = [];
    const apply = (before: unknown, now: unknown, node: IPatchNode): unknown => {
        if (node.leaf) {
            const result = reconcileSelection(before, now, onLiveInstance, onArraySubclass, ledger);
            if (now !== null && typeof now === 'object' && result !== null && typeof result === 'object') {
                filed.push([now, result]);
            }
            return result;
        }
        if (node.children === undefined) return before;
        if (!isPlainSpine(before) || now === null || typeof now !== 'object') throw new PatchFallback();
        let copy: Record<string, unknown> | undefined;
        for (const [key, child] of node.children) {
            if (!hasOwn.call(before, key)) throw new PatchFallback();
            const next = apply(before[key], Reflect.get(now, key), child);
            if (next === before[key]) continue;
            copy ??= cloneSpine(before);
            copy[key] = next;
        }
        if (copy === undefined) return before;
        filed.push([now, copy]);
        return copy;
    };
    try {
        const result = apply(previous, live, plan) as R;
        for (const [view, copy] of filed) {
            ledger.set(view, copy);
            const raw = liveViews.readTarget(view);
            if (raw !== undefined) ledger.set(raw, copy);
        }
        return result;
    } catch (error) {
        if (error instanceof PatchFallback) return undefined;
        throw error;
    }
};
