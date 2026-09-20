import {diagnostics} from "../Diagnostics/DiagnosticsInstance";
import {updateBatch} from "./UpdateBatchInstance";

// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}} | undefined;

const isThenable = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    return typeof (value as {then?: unknown}).then === 'function';
};

/**
 * Runs `body` as one update: every write inside it is delivered to subscribers once,
 * after the body returns. The body has to be synchronous — the batch closes when it
 * returns, so an async body would only cover the part before its first await.
 */
export const transaction = <R>(body: () => R): R => {
    updateBatch.begin();

    try {
        const result = body();

        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production' && isThenable(result)) {
            diagnostics.report(
                'transaction() was given an async body. The batch closes when the body returns, ' +
                'so only the writes before its first await are batched. Wrap the synchronous ' +
                'write block in transaction() instead.'
            );
        }

        return result;
    } finally {
        updateBatch.end();
    }
};
