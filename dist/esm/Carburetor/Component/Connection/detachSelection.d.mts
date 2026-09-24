/**
 * The detached form of a selection's value — the form safe to hand a child, at any depth.
 *
 * @see detachDeep for the descriptor policy; this entry point supplies a fresh cycle guard.
 */
export declare const detachSelection: (value: unknown) => unknown;
