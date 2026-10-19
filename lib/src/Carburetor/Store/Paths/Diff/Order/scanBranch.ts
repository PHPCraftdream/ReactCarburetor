import {countChanges} from "@/Carburetor/Store/Paths/Diff/Threshold/countChanges";
import {keyOrderRequiresReplay} from "./keyOrderRequiresReplay";

/** Outcome of the raw pre-pass: the difference cannot be installed natively, nothing differs,
 * or it is safe to apply. */
type BranchScan = 'blocked' | 'equal' | 'differ';

/** Shared with applyDiff: previous-side branches proven fully equal skip draft wrapping. */
interface IScanBudget {
    unchanged: Map<object, object>;
    /** Differing leaves seen so far, counted as `countChanges` counts them. */
    changes: number;
}

const hasOwn = Object.prototype.hasOwnProperty;
const isEnumerable = Object.prototype.propertyIsEnumerable;

/** One fused check for the scan's hot loop, equivalent to
 * `isTrackable(a) && isTrackable(b) && sameKind(a, b)` (whose modules stay canonical for the
 * rest of the engine): three cross-module calls per differing pair dominated the scan profile.
 */
const sameTrackableKind = (a: unknown, b: unknown): boolean => {
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    const prototype = Object.getPrototypeOf(a);
    if (prototype !== Object.getPrototypeOf(b)) return false;
    if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
        return false;
    }

    return Array.isArray(a) === Array.isArray(b);
};

/**
 * One raw pass over the pair, before any draft write: verifies native assignment can install the
 * difference (key order, locked lengths, non-configurable fields) and marks fully equal subtrees
 * in `budget.unchanged`, so applyKey never wraps them in a draft proxy.
 *
 * The same pass adds the differing leaves to `budget.changes`, as `countChanges` counts them,
 * so the size threshold needs no counting walk of its own.
 *
 * @param previous - the branch's current raw value.
 * @param next - the corresponding branch of the snapshot being installed; read only.
 * @param budget - shared scan/apply budget.
 * @returns 'blocked' when a write could be rejected, 'equal' when nothing differs, else 'differ'.
 */
export const scanBranch = (
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
    budget: IScanBudget
): BranchScan => {
    let differ = false;
    const previousKeys = Object.keys(previous);
    const array = Array.isArray(previous);

    // One enumeration of `next`'s own keys: count and positional order against `previousKeys`.
    // `nextKeys` is materialized only on the rare paths that need the list itself.
    let nextKeyCount = 0;
    let aligned = true;
    if (!array) {
        for (const key in next) {
            if (!hasOwn.call(next, key)) continue;
            if (nextKeyCount < previousKeys.length && previousKeys[nextKeyCount] !== key) aligned = false;
            nextKeyCount++;
        }
    }
    const sameKeys = aligned && nextKeyCount === previousKeys.length;

    if (!array) {
        if (!sameKeys && keyOrderRequiresReplay(previousKeys, Object.keys(next))) return 'blocked';
        if (!sameKeys) differ = true;
    }

    const previousLength = array ? (previous as unknown as unknown[]).length : 0;
    const nextLength = array ? (next as unknown as unknown[]).length : 0;
    const lengthLocked = array && Object.getOwnPropertyDescriptor(previous, 'length')?.writable === false;
    if (array && previousLength !== nextLength) {
        if (lengthLocked) return 'blocked';
        if (nextLength < previousLength) {
            for (const key of Reflect.ownKeys(previous)) {
                if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)
                    && Number(key) >= nextLength && Number(key) < previousLength
                    && Object.getOwnPropertyDescriptor(previous, key)?.configurable === false) return 'blocked';
            }
        }
        differ = true;
    }

    if (array) {
        // Index iteration instead of key enumeration: array order is fixed, so only the
        // per-index values matter. A `undefined` on either side is checked for holeness, so a
        // hole versus an explicit own `undefined` still reads as a difference.
        const previousList = previous as unknown as unknown[];
        const nextList = next as unknown as unknown[];
        const shared = previousLength < nextLength ? previousLength : nextLength;
        // A hole reads `undefined` unless the prototype chain holds that index; only then can an
        // equal or same-kind read hide an own-index change, which counts as one change.
        const prototype = Object.getPrototypeOf(previous) as object | null;
        for (let index = 0; index < shared; index++) {
            const oldValue = previousList[index];
            const newValue = nextList[index];
            if (Object.is(oldValue, newValue)) {
                if (oldValue === undefined) {
                    if (hasOwn.call(previous, index) !== hasOwn.call(next, index)) {
                        differ = true;
                        budget.changes++;
                    }
                } else if (prototype !== null && index in prototype
                    && hasOwn.call(previous, index) !== hasOwn.call(next, index)) budget.changes++;
                continue;
            }
            if (sameTrackableKind(oldValue, newValue)) {
                const counted = budget.changes;
                const child = scanBranch(
                    oldValue as Record<string, unknown>, newValue as Record<string, unknown>, budget
                );
                if (prototype !== null && index in prototype
                    && hasOwn.call(previous, index) !== hasOwn.call(next, index)) budget.changes = counted + 1;
                if (child === 'blocked') return 'blocked';
                if (child === 'differ') {
                    if (Object.getOwnPropertyDescriptor(previous, index)?.writable === false) return 'blocked';
                    differ = true;
                } else budget.unchanged.set(oldValue as object, newValue as object);
            } else {
                if (Object.getOwnPropertyDescriptor(previous, index)?.writable === false) return 'blocked';
                differ = true;
                budget.changes++;
            }
        }
        // Indices beyond the shared range: any previous-side non-configurable index that the
        // shrink would drop blocks the native write; everything else is covered by the length.
        if (nextLength < previousLength) {
            for (let index = shared; index < previousLength; index++) {
                if (!hasOwn.call(previous, index)) continue;
                if (Object.getOwnPropertyDescriptor(previous, index)?.configurable === false) {
                    return 'blocked';
                }
                budget.changes++;
            }
        }
        // Each own index the growth adds is one installed leaf.
        for (let index = shared; index < nextLength; index++) {
            if (hasOwn.call(next, index)) budget.changes++;
        }
    } else {
        for (const key of previousKeys) {
            // With aligned key sequences every previous key exists in `next` at the same slot.
            if (!sameKeys && !hasOwn.call(next, key)) {
                if (Object.getOwnPropertyDescriptor(previous, key)?.configurable === false) return 'blocked';
                differ = true;
                budget.changes++;
                continue;
            }
            const oldValue = previous[key];
            const newValue = next[key];
            if (Object.is(oldValue, newValue)) continue;
            if (sameTrackableKind(oldValue, newValue)) {
                const child = scanBranch(
                    oldValue as Record<string, unknown>, newValue as Record<string, unknown>, budget
                );
                if (child === 'blocked') return 'blocked';
                if (child === 'differ') {
                    // A proxy cannot wrap a non-writable own data value: a locked child that truly
                    // differs would throw on target[key], after earlier sibling writes.
                    const descriptor = Object.getOwnPropertyDescriptor(previous, key);
                    if (descriptor?.writable === false) return 'blocked';
                    differ = true;
                } else budget.unchanged.set(oldValue as object, newValue as object);
            } else {
                const descriptor = Object.getOwnPropertyDescriptor(previous, key);
                // A proxy cannot wrap a non-configurable, non-writable own data value. Even a
                // same-kind nested edit would throw on target[key], after earlier sibling writes.
                if (descriptor?.writable === false) return 'blocked';
                differ = true;
                budget.changes++;
            }
        }
    }
    if (!array) {
        if (!sameKeys) {
            // Keys `previous` does not enumerate; only a key-count change can need extension.
            const grows = nextKeyCount !== previousKeys.length;
            for (const key of Object.keys(next)) {
                if (isEnumerable.call(previous, key)) continue;
                if (hasOwn.call(previous, key)) {
                    budget.changes += countChanges(previous[key], next[key]);
                    continue;
                }
                if (grows && !Object.isExtensible(previous)) return 'blocked';
                differ = true;
                budget.changes++;
            }
        }
    } else if (lengthLocked || (nextLength > previousLength && !Object.isExtensible(previous))) {
        // A locked length (any length) or growth of a sealed array: a next-side index at or
        // beyond the previous length must not be added natively.
        for (const key of Object.keys(next)) {
            if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) >= previousLength
                && !hasOwn.call(previous, key)) return 'blocked';
        }
    }
    return differ ? 'differ' : 'equal';
};
