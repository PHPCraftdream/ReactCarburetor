import {TUpdateTraceListener} from '@/Carburetor/Store/Diagnostics/TraceListener';
import {IUpdateTrace} from '@/Carburetor/Store/Diagnostics/UpdateTrace';

/** One independent traceUpdates registration; the same listener may hold several. */
interface ITraceRegistration {
    /** The listener this registration delivers to. */
    listener: TUpdateTraceListener;
}

/** Active trace registrations and the epoch guarding pending deliveries. */
export const traceListeners = {
    /** Independent registrations; each disposer removes exactly its own entry. */
    registrations: new Set<ITraceRegistration>(),
    /** Changes only on the 0-to-1 and 1-to-0 registration transitions. */
    epoch: 0,
    /** Notifies every registration with one immutable trace event.
     *
     * @param subscriber - subscriber identifier or display label.
     * @param store - unique store identifier.
     * @param paths - changed paths matched by this subscription.
     * @param version - latest delivered store version.
     */
    notify(subscriber: string, store: string, paths: ReadonlySet<string>, version: number): void {
        const event: IUpdateTrace = Object.freeze({
            subscriber, store, paths: Object.freeze(Array.from(paths)), version, callback: 'invoked',
        });
        this.registrations.forEach(registration => {
            try { registration.listener(event); } catch { /* Trace observers must not interrupt delivery. */ }
        });
    },
};
