/**
 * The detached form of a selection, sharing the tracked-view/raw-target graph ledger with
 * watch and hook selections. Map/Set/Date contents are copied so a selected key can alias its
 * counterpart inside an opaque container without handing the child mutable store state.
 *
 * Ordinary class instances still pass through live; Array subclasses remain rejected.
 *
 * @param value - the candidate to detach
 */
export declare const detachSelection: (value: unknown) => unknown;
