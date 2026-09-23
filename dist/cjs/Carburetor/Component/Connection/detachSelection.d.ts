/**
 * The detached form of a selection's value — the form safe to hand a child, at any depth.
 *
 * @see detachDeep for what "detached" means at each level; this is only its entry point, with a
 * fresh cycle guard per call.
 */
export declare const detachSelection: (value: unknown) => unknown;
