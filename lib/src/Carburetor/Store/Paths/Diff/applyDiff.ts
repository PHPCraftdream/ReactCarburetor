import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";
import {DIFF_PATH_THRESHOLD} from "./DiffThreshold";
import {keyOrderRequiresReplay} from "./Order/keyOrderRequiresReplay";
import {sameKind} from "./sameKind";

/** Unwinds the walk once the threshold trips; caught inside applyDiff, never escapes it. */
class ApplyDiffOverflow extends Error {}

/** How many draft writes this call has made so far; threaded through, not module state. */
interface IBudget {
    spent: number;
    unchangedLocked?: WeakMap<object, object>;
}

const spend = (budget: IBudget): void => {
    budget.spent++;

    if (budget.spent > DIFF_PATH_THRESHOLD) {
        throw new ApplyDiffOverflow();
    }
};

/**
 * Assigns through `target`, guarding the one key whose plain assignment is not what it looks
 * like: an own `__proto__` falls back to the inherited setter and repoints the object's
 * prototype instead of creating a data property (R4-02) — the same reason `deepClone` uses
 * `defineProperty` for it. `Object.defineProperty` still reaches the draft's own `defineProperty`
 * trap, so the write is recorded exactly as an ordinary key's would be.
 */
const assign = (target: Record<string, unknown>, key: string, value: unknown): void => {
    if (key === '__proto__') {
        Object.defineProperty(target, key, {value, writable: true, enumerable: true, configurable: true});

        return;
    }

    target[key] = value;
};

const applyKey = (
    target: Record<string, unknown>,
    key: string,
    previous: unknown,
    next: unknown,
    budget: IBudget
): void => {
    if (Object.is(previous, next)) {
        return;
    }

    if (isTrackable(previous) && isTrackable(next) && sameKind(previous, next)) {
        if (budget.unchangedLocked?.get(previous) === next) return;
        applyBranch(
            target[key] as unknown as Record<string, unknown>,
            previous as unknown as Record<string, unknown>,
            next as unknown as Record<string, unknown>,
            budget
        );

        return;
    }

    spend(budget);
    assign(target, key, deepClone(next));
};

/** Only checked for a locked child with a changed reference: avoid reading its draft proxy. */
const sameRestorableValues = (left: object, right: object): boolean => {
    const seen = new WeakMap<object, object>();
    const equal = (a: unknown, b: unknown): boolean => {
        if (Object.is(a, b)) return true;
        if (!isTrackable(a) || !isTrackable(b) || !sameKind(a, b)) return false;
        if (seen.has(a)) return seen.get(a) === b;
        seen.set(a, b);
        if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false;
        const keys = Object.keys(a);
        const otherKeys = Object.keys(b);
        if (keys.length !== otherKeys.length) return false;
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] !== otherKeys[i] || !equal(
                (a as Record<string, unknown>)[keys[i]], (b as Record<string, unknown>)[keys[i]]
            )) return false;
        }
        return true;
    };
    return equal(left, right);
};

/** Check every affected branch before the first draft write: native assignment can reject
 * accepted read-only fields, locked lengths, non-configurable deletions, and key reordering.
 * A failed check sends restore through its detached root replacement instead.
 */
const canApplyOrder = (
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
    budget: IBudget
): boolean => {
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    const array = Array.isArray(previous);
    if (!array) {
        const sameOrder = previousKeys.length === nextKeys.length
            && previousKeys.every((key, index) => key === nextKeys[index]);
        if (!sameOrder && keyOrderRequiresReplay(previousKeys, nextKeys)) return false;
    }

    const previousLength = array ? (previous as unknown as unknown[]).length : 0;
    const nextLength = array ? (next as unknown as unknown[]).length : 0;
    const lengthLocked = array && Object.getOwnPropertyDescriptor(previous, 'length')?.writable === false;
    if (array && previousLength !== nextLength) {
        if (lengthLocked) return false;
        if (nextLength < previousLength) {
            for (const key of Reflect.ownKeys(previous)) {
                if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)
                    && Number(key) >= nextLength && Number(key) < previousLength
                    && Object.getOwnPropertyDescriptor(previous, key)?.configurable === false) return false;
            }
        }
    }

    for (const key of previousKeys) {
        if (!Object.prototype.hasOwnProperty.call(next, key)) {
            if (Object.getOwnPropertyDescriptor(previous, key)?.configurable === false) return false;
            continue;
        }
        const oldValue = previous[key];
        const newValue = next[key];
        if (Object.is(oldValue, newValue)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(previous, key);
        // A proxy cannot wrap a non-configurable, non-writable own data value. Even a
        // same-kind nested edit would throw on target[key], after earlier sibling writes.
        if (descriptor?.writable === false && descriptor.configurable === false) {
            if (!isTrackable(oldValue) || !isTrackable(newValue) ||
                !sameRestorableValues(oldValue, newValue)) return false;
            (budget.unchangedLocked ??= new WeakMap<object, object>()).set(oldValue, newValue);
            continue;
        }
        if (isTrackable(oldValue) && isTrackable(newValue) && sameKind(oldValue, newValue)) {
            if (!canApplyOrder(
                oldValue as Record<string, unknown>, newValue as Record<string, unknown>, budget
            )) return false;
        } else if (descriptor?.writable === false) return false;
    }
    for (const key of nextKeys) {
        if (Object.prototype.hasOwnProperty.call(previous, key)) continue;
        if (!Object.isExtensible(previous) || (array && lengthLocked
            && /^(0|[1-9]\d*)$/.test(key) && Number(key) >= previousLength)) return false;
    }
    return true;
};

const applyBranch = (
    target: Record<string, unknown>,
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
    budget: IBudget
): void => {
    const previousLength = (previous as unknown as unknown[]).length;
    const nextLength = (next as unknown as unknown[]).length;

    if (Array.isArray(previous) && nextLength !== previousLength) {
        // A sparse-tail growth adds no own index for the key loops below; a shrink must truncate,
        // not `delete` per index. The write proxy's `length` handling records either.
        spend(budget);
        (target as unknown as {length: number}).length = nextLength;
    }

    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    const seen = new Set<string>();

    for (const key of previousKeys) {
        seen.add(key);

        if (!Object.prototype.hasOwnProperty.call(next, key)) {
            spend(budget);
            delete target[key];

            continue;
        }

        applyKey(target, key, previous[key], next[key], budget);
    }

    for (const key of nextKeys) {
        if (seen.has(key)) {
            continue;
        }

        spend(budget);
        assign(target, key, deepClone(next[key]));
    }
};

/**
 * Applies the difference between `previous` and `next` into `target` — a live draft branch —
 * so only the paths that actually changed are announced (through the draft's own write traps)
 * and an untouched branch keeps its object identity: nothing is reassigned unless it differs.
 *
 * Every assigned value is deep-cloned first, so `next`'s own object graph is never adopted into
 * the store. A key order that native deletion/append cannot install is rejected before any draft
 * mutation; `restore` then falls back to an owned root copy. Oversized diffs also return `false`
 * after `DIFF_PATH_THRESHOLD` draft writes, preserving the existing threshold fallback.
 *
 * Caller's responsibility: `previous` and `next` must already share a kind and supported
 * prototype at the root — `restore` checks once before calling here; nested mismatches are
 * resolved per key as the walk reaches them.
 *
 * @param target - the draft branch to mutate.
 * @param previous - the branch's current raw value.
 * @param next - the corresponding branch of the snapshot being installed; read only.
 */
export const applyDiff = (
    target: Record<string, unknown>,
    previous: Record<string, unknown>,
    next: Record<string, unknown>
): boolean => {
    const budget: IBudget = {spent: 0};
    if (!canApplyOrder(previous, next, budget)) return false;

    try {
        applyBranch(target, previous, next, budget);
    } catch (error) {
        if (error instanceof ApplyDiffOverflow) {
            return false;
        }

        throw error;
    }

    return true;
};
