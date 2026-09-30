import {ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {renderOwner} from "./renderOwner";

/** Computeds already reported once; the escape is a declaration mistake, one complaint names it. */
const reported: WeakSet<ICarburetorSubscription> = new WeakSet();

/**
 * Development diagnostic for `Computed.recordDependencyRead`: warns once when a component
 * renders through this computed's live result without being one of its subscribers — the
 * result reached it through props rather than the component's own `useComputed()` call.
 *
 * Call only for a "late" read: one that lands after the body's own evaluation already
 * published the dependency the read belongs to. A read during the body's own evaluation is
 * the computed computing itself, never an escape — and a subscriber's own leaf read of the
 * result it just asked for is not one either, because `useComputed` tracks the computed
 * before it reads it, so that owner already passes `hasTracked` below.
 *
 * @param source - the computed instance being read; the once-per-computed key, and what a
 * render owner's legitimacy is checked against
 * @param isSubscriber - whether a given subscription id is currently subscribed to `source`
 */
export const reportComputedEscape = (
    source: ICarburetorSubscription,
    isSubscriber: (uid: string) => boolean
): void => {
    if (reported.has(source)) {
        return;
    }

    const owner = renderOwner.get();

    if (owner === undefined || isSubscriber(owner.uid) || owner.hasTracked(source)) {
        return;
    }

    reported.add(source);

    diagnostics.report(
        "a component rendered through a computed's live result without subscribing to it: the " +
        'value reached it through props instead of its own useComputed() call. A write inside the ' +
        'result then re-renders the whole tree that produced it, not just this component. Return ' +
        'ids or plain values from the computed and read the store in the row, or pass {equals} so ' +
        'an unaffected recompute does not re-announce.'
    );
};
