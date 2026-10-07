import {diagnostics} from "./DiagnosticsInstance";

declare const process: {env: {NODE_ENV?: string}} | undefined;

/** Reports a subscriber that threw during delivery; the write had already landed.
 *
 * @param error - the thrown value.
 */
export const reportDeliveryFailure = (error: unknown): void => {
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
        diagnostics.report(
            'a subscriber threw while a write was delivered: '
            + (error instanceof Error ? error.message : String(error))
            + '. The write had already landed, so the remaining subscribers were notified anyway.'
        );
    }
};
