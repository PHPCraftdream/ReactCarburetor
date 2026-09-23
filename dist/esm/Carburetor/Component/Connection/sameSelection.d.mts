/**
 * Whether a fresh selection has the same content as the snapshot already handed out, so "same"
 * here means the handed-out snapshot may keep its identity — and the gated child keeps its
 * bail-out.
 *
 * A plain object compares its own enumerable string and symbol keys — the exact set a shallow
 * spread copies — for membership plus `Object.is` values, and an array compares its length and
 * elements with `Object.is`, the exact set `Array.from` copies. The detached previous snapshot
 * is compared against the raw fresh selection: a shallow copy shares every member with its
 * source, so identity differences introduced by detaching say nothing about content.
 *
 * @param snapshot - the snapshot already handed out, possibly detached from its source
 * @param next - the fresh selection to compare it against
 */
export declare const sameSelection: (snapshot: unknown, next: unknown) => boolean;
