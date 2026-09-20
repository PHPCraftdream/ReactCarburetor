import {updateBatch} from "./UpdateBatchInstance";

/**
 * Runs `body` as one update: every write inside it is delivered to subscribers once,
 * after the body returns. The body has to be synchronous — the batch closes when it
 * returns, so an async body would only cover the part before its first await.
 */
export const transaction = <R>(body: () => R): R => {
    updateBatch.begin();

    try {
        return body();
    } finally {
        updateBatch.end();
    }
};
