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
 * Caller's responsibility: `previous` and `next` must already be the same kind (both arrays or
 * both plain objects) with no symbol-key difference at the root — `restore` checks once before
 * calling here; every nested mismatch is resolved per key as the walk reaches it.
 *
 * @param target - the draft branch to mutate.
 * @param previous - the branch's current raw value.
 * @param next - the corresponding branch of the snapshot being installed; read only.
 */
export declare const applyDiff: (target: Record<string, unknown>, previous: Record<string, unknown>, next: Record<string, unknown>) => boolean;
