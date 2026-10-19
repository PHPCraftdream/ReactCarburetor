import {viewKeys} from "@/Carburetor/Store/Tracking/Models";
import {AddedMembers} from "./AddedMembers";

const hasOwn = Object.prototype.hasOwnProperty;

/** Stores one field, handling an own `__proto__` key safely. */
const assign = (result: Record<string, unknown>, key: string, value: unknown): void => {
    if (key === '__proto__') {
        Object.defineProperty(result, key, {value, writable: true, enumerable: true, configurable: true});
    } else {
        result[key] = value;
    }
};

/**
 * Applies key insertions and deletions of the selected plain object to its previous snapshot,
 * without walking the entries that stayed: their keys were not written, so each keeps its copy.
 *
 * A written key present both before and now (a replacement, or a delete and re-add) answers
 * undefined, for the full reconcile. The copy follows the live key order, as the full walk's does;
 * every key that vanished must be one of the written keys, or the batch is refused.
 *
 * @param previous - the previous snapshot of the object
 * @param live - the live view of the same object
 * @param raw - the object's raw object
 * @param keys - the object's own keys written since the snapshot
 * @param added - detaches the added entries
 * @returns the new snapshot, the previous one when nothing changed, or undefined
 */
export const patchKeyedStructure = (
    previous: Record<string, unknown>, live: object, raw: object, keys: ReadonlySet<string>, added: AddedMembers
): Record<string, unknown> | undefined => {
    const inserted = new Set<string>();
    let removed = 0;
    for (const key of keys) {
        const was = hasOwn.call(previous, key);
        const is = hasOwn.call(raw, key);
        if (was && is) return undefined;
        if (was) removed++;
        else if (is) inserted.add(key);
    }
    if (removed === 0 && inserted.size === 0) return previous;
    const order = viewKeys(live);
    const prototype = Object.getPrototypeOf(raw) as object | null;
    const result: Record<string, unknown> = prototype === Object.prototype
        ? {} : Object.create(prototype) as Record<string, unknown>;
    let kept = 0;
    for (let index = 0; index < order.length; index++) {
        const key = order[index];
        if (inserted.has(key)) {
            const copy = added.detach(Reflect.get(live, key));
            if (added.refused) return undefined;
            assign(result, key, copy);
        } else if (hasOwn.call(previous, key)) {
            assign(result, key, previous[key]);
            kept++;
        } else return undefined;
    }
    if (kept + inserted.size !== order.length || Object.keys(previous).length !== kept + removed) return undefined;
    return result;
};
