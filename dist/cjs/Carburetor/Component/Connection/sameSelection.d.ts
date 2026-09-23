/**
 * Whether a fresh selection has the same content as the snapshot already handed out, so "same"
 * here means the handed-out snapshot may keep its identity — and the gated child keeps its
 * bail-out.
 *
 * The comparison walks the whole selected structure on every call (R5-07): the selector must run
 * per render to renew its read tracking, and a detached snapshot can never short-circuit against
 * the fresh read by reference. Skipping the walk while the store version has not moved would
 * assume the selector reads nothing but store data, which a selector capturing a changing prop
 * quietly violates — small projections stay the answer for frequently rerendered parents.
 *
 * @param snapshot - the snapshot already handed out, possibly detached from its source
 * @param next - the fresh selection to compare it against
 */
export declare const sameSelection: (snapshot: unknown, next: unknown) => boolean;
