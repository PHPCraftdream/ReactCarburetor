import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {liveViews} from "@/Carburetor/Store/Tracking/liveViews";
import {isPlainObject} from "./isPlainObject";

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
export const reportLiveViewEscape = (next: unknown): boolean => {
    const guidance = 'A child reading it in its own render records nothing, so no subscription covers what it ' +
        'sees and it never hears about changes. Select plain values — primitives, or plain objects and arrays ' +
        'built from them.';

    if (liveViews.has(next)) {
        diagnostics.report(
            'a connectSelection() snapshot handed a child a live store view as its whole value. ' + guidance
        );

        return true;
    }

    if (Array.isArray(next)) {
        const index = next.findIndex((member: unknown): boolean => liveViews.has(member));

        if (index !== -1) {
            diagnostics.report(
                'a connectSelection() snapshot handed a child a live store view as array member ' +
                index + '. ' + guidance
            );

            return true;
        }

        return false;
    }

    if (isPlainObject(next)) {
        // Binding narrowed ahead of the callback: a `.find` body runs outside the guard's
        // narrowing reach.
        const members: Record<string, unknown> = next;
        const key = Object.keys(members).find((memberKey: string): boolean => liveViews.has(members[memberKey]));

        if (key !== undefined) {
            diagnostics.report(
                'a connectSelection() snapshot handed a child a live store view as member "' +
                key + '". ' + guidance
            );

            return true;
        }
    }

    return false;
};
