import {diagnostics} from "./DiagnosticsInstance";

declare const process: {env: {NODE_ENV?: string}} | undefined;

/** Reports an update callback that returned a promise, whose post-await writes wake nobody.
 *
 * @param result - the update callback's return value.
 */
export const warnIfAsyncMutate = (result: unknown): void => {
    // An async callback is accepted by a void-returning signature, and then everything it
    // writes after the first await lands in the data long after this emitUpdate has run.
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'
        && result instanceof Promise) {
        diagnostics.report(
            'update(mutate) published before the mutation finished: the callback returned '
            + 'a promise, so writes made after its first await wake nobody. Keep the '
            + 'callback synchronous and publish after the await instead.'
        );
    }
};
