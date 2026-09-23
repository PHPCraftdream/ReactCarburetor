import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

// Declared locally rather than through @types/node, like DevelopmentFlag does: bundlers
// substitute this exact member expression at build time, which is what keeps the guarded
// block below droppable from a production bundle.
declare const process: {env: {NODE_ENV?: string}} | undefined;

/** The one event the stand-in signal delivers, aimed at the signal itself as its target. */
interface IShimEvent {
    type: 'abort';
    target: unknown;
}

/** An abort listener: a callback, or an object whose handleEvent method receives the event. */
type TShimListener = ((event: IShimEvent) => void) | {handleEvent: (event: IShimEvent) => void};

/** Whether the missing global has been reported, so a long session is not buried in repeats. */
let reported = false;

/**
 * Builds the abort handle one resource request runs under: the runtime's `AbortController`
 * where it exists, a minimal stand-in where it does not.
 *
 * The stand-in exists because `AbortController` reached Node's globals in 14.17.0, while
 * `engines.node` advertises 14.6.0 — the `WeakRef` floor — so the oldest advertised runtime
 * has no such global, and constructing the real one made every load throw before it could
 * start (R5-04). There the request degrades to unabortable, and development says so once:
 * the loader receives a signal that honors abort(), fires the abort listeners it registered,
 * and answers throwIfAborted() and an onabort assignment the way the native one does, so it
 * can still be told to stop its work; what remains is that the stand-in is not a native
 * `AbortSignal`, so an API demanding native identity (fetch among them) rejects it and the
 * request itself is never interrupted. The state machine above the loader does not degrade —
 * a superseded or aborted answer is still discarded on landing, because that comparison reads
 * `signal.aborted`, which the stand-in honors. Browsers and every newer Node ship the real
 * thing, so the first branch is the one that runs in practice.
 */
export const createAbortHandle = (): AbortController => {
    if (typeof AbortController === 'function') {
        return new AbortController();
    }

    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production' && !reported) {
        reported = true;

        diagnostics.report(
            'this runtime has no AbortController (Node added one in 14.17.0; the advertised ' +
            'floor is 14.6.0), so cancellation degrades: the stand-in signal honors abort(), ' +
            'fires the abort listeners a loader registered, and still keeps a late answer from ' +
            'being stored, but it is not a native AbortSignal, so an API that demands native ' +
            'signal identity (fetch, for one) rejects it and nothing interrupts the request ' +
            'itself.'
        );
    }

    const listeners: TShimListener[] = [];

    const signal: {aborted: boolean} = {aborted: false};

    // A duplicate would fire one listener twice, and one registered after the abort would
    // never fire at all — the native event behaves the same way on both counts.
    const addEventListener = (type: string, listener: TShimListener): void => {
        if (type !== 'abort' || signal.aborted || listeners.indexOf(listener) !== -1) {
            return;
        }

        listeners.push(listener);
    };

    const removeEventListener = (type: string, listener: TShimListener): void => {
        if (type !== 'abort') {
            return;
        }

        const at = listeners.indexOf(listener);

        if (at === -1) {
            return;
        }

        listeners.splice(at, 1);
    };

    // The onabort handler: assignment replaces it rather than accumulating, and null clears
    // it — the attribute-style counterpart of the listener list above, kept separate so the
    // two registrations stay independent exactly as they are natively.
    let onAbort: TShimListener | null = null;

    const invoke = (listener: TShimListener, event: IShimEvent): void => {
        if (typeof listener === 'function') {
            listener(event);

            return;
        }

        listener.handleEvent(event);
    };

    // The native one throws a DOMException named AbortError; without that global — and
    // without pulling in a dependency — an Error carrying the same name is the closest
    // match the advertised floor allows.
    const throwIfAborted = (): void => {
        if (signal.aborted) {
            const error = new Error('This operation was aborted');

            error.name = 'AbortError';

            throw error;
        }
    };

    // One listener's exception must not stop the event: native delivery reaches every
    // listener and reports a throwing one without throwing out of abort(), and the engine's
    // cancelInFlight() relies on that to finish its cleanup (R7-03). Development-only, like
    // the report above, so a production bundle drops it.
    const reportListenerError = (error: unknown): void => {
        if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') {
            return;
        }

        diagnostics.report(
            'an abort listener threw while the stand-in signal was delivering the abort event; ' +
            'the remaining listeners still ran and the error did not escape abort(): ' +
            (error instanceof Error ? error.message : String(error))
        );
    };

    // Defined rather than assigned, so the descriptor keeps its defaults and the listener
    // surface stays non-enumerable: an equality check against the bare {aborted: false}
    // flag — what the R5-04 tests assert — compares enumerable properties only and still
    // sees a signal that is exactly that flag.
    Object.defineProperty(signal, 'addEventListener', {value: addEventListener});
    Object.defineProperty(signal, 'removeEventListener', {value: removeEventListener});
    Object.defineProperty(signal, 'throwIfAborted', {value: throwIfAborted});

    Object.defineProperty(signal, 'onabort', {
        get: (): TShimListener | null => onAbort,
        set: (handler: unknown): void => {
            const usable = typeof handler === 'function' || (
                typeof handler === 'object' &&
                handler !== null &&
                typeof (handler as {handleEvent?: unknown}).handleEvent === 'function'
            );

            onAbort = usable ? handler as TShimListener : null;
        },
    });

    const handle = {
        signal,
        abort(): void {
            if (signal.aborted) {
                return;
            }

            signal.aborted = true;

            // Snapshot then clear before invoking: a listener may remove itself or another
            // mid-delivery, and everything registered at the moment of the abort fires
            // exactly once, which is the native event's one-shot delivery.
            const firing: TShimListener[] = listeners.slice();

            listeners.length = 0;

            const event: IShimEvent = {type: 'abort', target: signal};

            firing.forEach((listener: TShimListener): void => {
                try {
                    invoke(listener, event);
                } catch (error: unknown) {
                    reportListenerError(error);
                }
            });

            // Delivered after the listener list: the shim does not interleave the two
            // surfaces by registration order the way a native dispatch would.
            if (onAbort !== null) {
                try {
                    invoke(onAbort, event);
                } catch (error: unknown) {
                    reportListenerError(error);
                }
            }
        },
    };

    // The engine touches the handle only through signal.aborted and abort(), which the
    // stand-in implements; the loader receives the signal typed as AbortSignal and finds
    // the surface a standard loader uses — listener registration, throwIfAborted, onabort —
    // leaving native signal identity as the one thing the stand-in still cannot offer.
    return handle as unknown as AbortController;
};
