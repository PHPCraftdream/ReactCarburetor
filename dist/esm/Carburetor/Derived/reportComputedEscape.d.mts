import { ICarburetorSubscription } from "../Models/Store.mjs";
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
export declare const reportComputedEscape: (source: ICarburetorSubscription, isSubscriber: (uid: string) => boolean) => void;
