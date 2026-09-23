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
export declare const createAbortHandle: () => AbortController;
