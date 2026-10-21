import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}};

/**
 * Reports one isolated subscriber failure outside production builds.
 *
 * @param error - the thrown subscriber error
 */
export const reportSubscriberFailure = (error: unknown): void => {
    if (process.env.NODE_ENV !== 'production') {
        diagnostics.report(
            'a subscriber threw while a computed value was delivered: ' +
            (error instanceof Error ? error.message : String(error)) +
            '. The remaining subscribers were notified anyway.'
        );
    }
};
