import {AddedMembers} from "./AddedMembers";

const hasOwn = Object.prototype.hasOwnProperty;

/** Ascending numeric order. */
const ascending = (left: number, right: number): number => left - right;

/** True for canonical integer array-index property names. */
const isArrayIndex = (key: string): boolean => {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < 0xFFFFFFFF && String(index) === key;
};

/**
 * Applies an append or a tail truncation of the selected array to its previous snapshot, without
 * walking the members that stayed: their slots were not written, so each keeps its copy.
 *
 * Only indices at or past the shorter of the two lengths may have been written; any write inside
 * the kept prefix (a replacement or a move) answers undefined, for the full reconcile. The prefix is
 * copied by pointer with its holes, own added indices are detached through the live view, and a
 * hole the growth leaves subscribes to the key set exactly as the full walk's sparse pass does.
 *
 * @param previous - the previous snapshot of the array
 * @param live - the live view of the same array
 * @param raw - the array's raw object
 * @param keys - the array's own keys written since the snapshot, `length` included
 * @param added - detaches the added members
 * @returns the new snapshot, the previous one when nothing changed, or undefined
 */
export const patchArrayStructure = (
    previous: unknown[], live: unknown[], raw: unknown[], keys: ReadonlySet<string>, added: AddedMembers
): unknown[] | undefined => {
    const before = previous.length;
    const after = live.length;
    const kept = Math.min(before, after);
    const grown: number[] = [];
    for (const key of keys) {
        if (key === 'length') continue;
        if (!isArrayIndex(key)) return undefined;
        const index = Number(key);
        if (index < kept) return undefined;
        if (index < after && hasOwn.call(raw, key)) grown.push(index);
    }
    if (after === before) return previous;
    const result = Array.prototype.slice.call(previous, 0, kept) as unknown[];
    result.length = after;
    if (grown.length < after - kept) void Reflect.ownKeys(live);
    grown.sort(ascending);
    for (let index = 0; index < grown.length; index++) {
        const copy = added.detach(Reflect.get(live, grown[index]));
        if (added.refused) return undefined;
        result[grown[index]] = copy;
    }
    return result;
};
