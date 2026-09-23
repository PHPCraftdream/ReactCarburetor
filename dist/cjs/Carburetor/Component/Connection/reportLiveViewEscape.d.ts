/**
 * The development diagnostic for a selection that hands a live view to a child.
 *
 * Reported once per selection, not per render — the mistake is the declaration's, and one
 * complaint names it. Returns whether a report was made, so the caller latches only on a real
 * escape and a selection that only later starts handing out a live view is still caught;
 * production compiles the call site out, leaving behavior unchanged.
 *
 * @param next - the fresh selection to inspect: its whole value first, then its members one
 * level deep
 */
export declare const reportLiveViewEscape: (next: unknown) => boolean;
