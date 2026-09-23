import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

// Declared locally rather than through @types/node, like DevelopmentFlag does: bundlers
// substitute this exact member expression at build time, which is what keeps the guarded
// block below droppable from a production bundle.
declare const process: {env: {NODE_ENV?: string}} | undefined;

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
 * the loader receives a signal that only ever flips `aborted`, so it cannot be told to stop
 * its work. The state machine above the loader does not degrade — a superseded or aborted
 * answer is still discarded on landing, because that comparison reads `signal.aborted`,
 * which the stand-in honors. Browsers and every newer Node ship the real thing, so the
 * first branch is the one that runs in practice.
 */
export const createAbortHandle = (): AbortController => {
    if (typeof AbortController === 'function') {
        return new AbortController();
    }

    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production' && !reported) {
        reported = true;

        diagnostics.report(
            'this runtime has no AbortController (Node added one in 14.17.0; the advertised ' +
            'floor is 14.6.0), so resource requests degrade to unabortable: the loader is ' +
            'handed a signal that never fires, and abort() can only keep a late answer from ' +
            'being stored, not stop the request itself.'
        );
    }

    const handle = {
        signal: {aborted: false},
        abort(): void {
            handle.signal.aborted = true;
        },
    };

    // The engine touches the handle only through signal.aborted and abort(), which the
    // stand-in implements; the loader receives the signal typed as AbortSignal and finds a
    // plainer object than a real one, which is the documented degradation.
    return handle as unknown as AbortController;
};
