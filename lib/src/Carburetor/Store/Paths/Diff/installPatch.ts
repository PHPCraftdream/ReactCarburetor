import {IWritePatch} from "../../../Models/Paths";
import {isTrackable} from "../../Tracking/isTrackable";
import {deepClone} from "../../Utils/deepClone";
import {isOrderedStringKey} from "./Order/isOrderedStringKey";
import {orderReplayGuard} from "./Order/orderReplayGuard";

const hasOwn = Object.prototype.hasOwnProperty;

/** The baseline's ordered keys from a deleted position on, shared per container per entry. */
interface IOrderPlan {readonly keys: readonly string[]; readonly from: number}

/**
 * Re-appends the baseline's ordered string keys that followed a deleted key, so the key
 * reinstated by the inverse install regains its original enumeration position.
 *
 * @param node - the container the deletion was undone on.
 * @param plan - the baseline's ordered keys from the deleted position on.
 */
const reinstateOrder = (node: Record<string, unknown>, plan: IOrderPlan): void => {
    const keys = plan.keys;
    orderReplayGuard.depth++;
    try {
        for (let index = plan.from; index < keys.length; index++) {
            const key = keys[index];
            if (!isOrderedStringKey(key) || !hasOwn.call(node, key)) continue;
            const value = node[key];
            delete node[key];
            if (key === '__proto__') {
                Object.defineProperty(node, key,
                    {value, writable: true, enumerable: true, configurable: true});
            } else {
                node[key] = value;
            }
        }
    } finally {
        orderReplayGuard.depth--;
    }
};

/**
 * Installs one patch's `previous` (undo) or `next` (redo) into `root` by walking its segments.
 *
 * Segments are raw, unescaped keys, so no path-unescaping is needed. Works on any
 * bracket-indexable target: `draft` (the write then lands through the proxy's own traps and is
 * announced normally) or a plain detached object (`CarburetorHistory`'s baseline mirror). A
 * plain value is deep-cloned before installing, so replaying the same patch again cannot alias
 * it into two places at once (R16-07).
 *
 * @param root - the object the patch's segments are resolved from.
 * @param patch - the patch to install.
 * @param inverse - false installs `next`; true installs `previous`, deleting when absent; an
 * order-carrying deletion also reinstates its key's original enumeration position.
 */
export const installPatch = (root: Record<string, unknown>, patch: IWritePatch, inverse: boolean): void => {
    let node: Record<string, unknown> = root;

    for (let i = 0; i < patch.segments.length - 1; i++) {
        const segment = patch.segments[i];
        if (!Object.prototype.hasOwnProperty.call(node, segment)) {
            throw new Error('Carburetor: patch path is missing an own segment');
        }
        node = node[segment] as Record<string, unknown>;
    }

    const key = patch.segments[patch.segments.length - 1];
    const value = inverse ? patch.previous : patch.next;

    if (!(inverse ? patch.previousExists : patch.nextExists)) {
        delete node[key];
    } else if (key === '__proto__') {
        Object.defineProperty(node, key, {
            value: isTrackable(value) ? deepClone(value) : value,
            writable: true, enumerable: true, configurable: true,
        });
    } else {
        node[key] = isTrackable(value) ? deepClone(value) : value;
    }

    if (inverse && patch.orderPlan !== undefined) reinstateOrder(node, patch.orderPlan);
};
