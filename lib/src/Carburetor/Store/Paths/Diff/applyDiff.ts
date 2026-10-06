import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";
import {DIFF_PATH_THRESHOLD} from "./Threshold/DIFF_PATH_THRESHOLD";
import {shouldCollapseDiff} from "./Threshold/shouldCollapseDiff";
import {scanBranch} from "./Order/scanBranch";
import {sameKind} from "./Kinds/sameKind";

const hasOwn = Object.prototype.hasOwnProperty;

class ApplyDiffOverflow extends Error {}
/** How many draft writes this call has made so far; threaded through, not module state. */
interface IBudget {
    spent: number;
    unchanged: Map<object, object>;
}

/** Counts differing leaves, stopping once `stopAfter` is passed (the count is then only a lower bound). */
const countChanges = (previous: unknown, next: unknown, stopAfter: number): number => {
    if (Object.is(previous, next)) return 0;
    if (!isTrackable(previous) || !isTrackable(next) || !sameKind(previous, next)) return 1;
    let count = 0;
    if (Array.isArray(previous)) {
        const oldArray = previous as unknown[];
        const newArray = next as unknown[];
        for (let index = 0; index < Math.max(oldArray.length, newArray.length); index++) {
            const oldOwn = hasOwn.call(oldArray, index);
            const newOwn = hasOwn.call(newArray, index);
            if (oldOwn === newOwn && Object.is(oldArray[index], newArray[index])) continue;
            count += oldOwn && newOwn ? countChanges(oldArray[index], newArray[index], stopAfter - count) : 1;
            if (count > stopAfter) return count;
        }
        return count;
    }
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
        if (!hasOwn.call(previous, key) || !hasOwn.call(next, key)) { count++; continue; }
        count += countChanges(
            (previous as Record<string, unknown>)[key], (next as Record<string, unknown>)[key], stopAfter - count
        );
        if (count > stopAfter) return count;
    }
    return count;
};

const countLeaves = (value: unknown): number => {
    if (!isTrackable(value)) return 1;
    let count = 0;
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
            if (!Object.prototype.hasOwnProperty.call(value, index)) continue;
            const child = value[index];
            count += isTrackable(child) ? countLeaves(child) : 1;
        }
        return count || 1;
    }
    for (const key of Object.keys(value)) {
        const child = (value as Record<string, unknown>)[key];
        count += isTrackable(child) ? countLeaves(child) : 1;
    }
    return count || 1;
};
const spend = (budget: IBudget): void => {
    budget.spent++;
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

    // The scan proved this exact previous/next pair fully equal: skip before any kind check,
    // so the walk only touches the draft (wrapping it) on the path to a real difference. A
    // shared previous with a different next here is NOT skipped: it descends and applies.
    // `next` can be `undefined` here (own value replaced by `undefined`); the map never stores
    // an `undefined` next, so guard the lookup to keep that replacement from being skipped.
    if (next !== undefined && budget.unchanged.get(previous as object) === next) {
        return;
    }

    if (isTrackable(previous) && isTrackable(next) && sameKind(previous, next)) {
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

/**
 * The array twin of the object key loops: index iteration instead of `Object.keys`, so a large
 * array costs numeric reads and one `applyKey` call per genuinely changed index. Hole semantics
 * match the object loops — a hole versus an own value deletes; an own `undefined` stays a value.
 *
 * @param target - the draft array branch to mutate.
 * @param previous - the array's current raw value.
 * @param next - the corresponding array of the snapshot being installed; read only.
 * @param previousLength - `previous.length`, read once by the caller.
 * @param nextLength - `next.length`, read once by the caller.
 * @param budget - shared scan/apply budget.
 */
const applyArray = (
    target: Record<string, unknown>,
    previous: unknown[],
    next: unknown[],
    previousLength: number,
    nextLength: number,
    budget: IBudget
): void => {
    const shared = previousLength < nextLength ? previousLength : nextLength;
    for (let index = 0; index < shared; index++) {
        const previousValue = previous[index];
        const nextValue = next[index];
        if (Object.is(previousValue, nextValue)) {
            // Equal `undefined`s can still differ as state: an own `undefined` versus a hole is
            // a key-set change (added or removed own index) at an unchanged length.
            if (previousValue === undefined
                && hasOwn.call(previous, index) !== hasOwn.call(next, index)) {
                spend(budget);
                if (hasOwn.call(previous, index)) delete target[index];
                else assign(target, String(index), deepClone(undefined));
            }

            continue;
        }
        // Same short-circuit as applyKey, before the index key string is ever built.
        if (nextValue !== undefined && budget.unchanged.get(previousValue as object) === nextValue) {
            continue;
        }
        if (nextValue === undefined && !Object.prototype.hasOwnProperty.call(next, index)) {
            spend(budget);
            delete target[index];

            continue;
        }
        applyKey(target, String(index), previousValue, nextValue, budget);
    }
    for (let index = shared; index < previousLength; index++) {
        spend(budget);
        delete target[index];
    }
    for (let index = shared; index < nextLength; index++) {
        if (!Object.prototype.hasOwnProperty.call(next, index)) continue;
        spend(budget);
        assign(target, String(index), deepClone(next[index]));
    }
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

    if (Array.isArray(previous) && Array.isArray(next)) {
        applyArray(target, previous, next, previousLength, nextLength, budget);

        return;
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
 * A raw pre-pass (scanBranch) runs before the first draft write. It rejects key orders,
 * locked lengths, and non-configurable edits that native assignment cannot install, and it
 * records previous/next pairs whose subtrees are fully equal, so the walk never wraps those
 * branches in a draft proxy. Every assigned value is deep-cloned first, so `next`'s own
 * object graph is never adopted into the store. A key order that native deletion/append
 * cannot install is rejected before any draft mutation; `restore` then falls back to an owned
 * root copy. Oversized diffs also return `false` when `shouldCollapseDiff` reports collapse,
 * preserving the existing threshold fallback.
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
    const scanBudget: IBudget = {spent: 0, unchanged: new Map<object, object>()};
    const scan = scanBranch(previous, next, scanBudget);
    if (scan === 'blocked') return false;
    if (scan === 'equal') return true;
    // Only past the floor does the answer depend on the branch's size, so the common restore pays
    // for the changed region alone.
    if (countChanges(previous, next, DIFF_PATH_THRESHOLD) > DIFF_PATH_THRESHOLD
        && shouldCollapseDiff(countChanges(previous, next, Infinity), countLeaves(previous))) return false;

    // No fixed mid-apply cutoff: preflight above decides eligibility atomically. Bound writes by
    // the relative limit so the draft walk cannot partially mutate and then overflow.
    const budget: IBudget = {spent: 0, unchanged: scanBudget.unchanged};
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
