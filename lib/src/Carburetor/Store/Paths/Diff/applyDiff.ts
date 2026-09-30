import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";
import {DIFF_PATH_THRESHOLD} from "./DiffThreshold";
import {sameKind} from "./sameKind";

/** Unwinds the walk once the threshold trips; caught inside applyDiff, never escapes it. */
class ApplyDiffOverflow extends Error {}

/** How many draft writes this call has made so far; threaded through, not module state. */
interface IBudget {
    spent: number;
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
 * the store — the caller (`restore`) keeps its ownership contract even though this walks into
 * it. Gives up past `DIFF_PATH_THRESHOLD` draft writes, returning `false` so the caller can fall
 * back to a wholesale swap instead of paying for thousands of individual ones.
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
    try {
        applyBranch(target, previous, next, {spent: 0});
    } catch (error) {
        if (error instanceof ApplyDiffOverflow) {
            return false;
        }

        throw error;
    }

    return true;
};
