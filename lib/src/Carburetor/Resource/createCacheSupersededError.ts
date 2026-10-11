/**
 * A cache request cancelled before its loader runs cannot produce an answer.
 * The versioned descriptor is shared across formats/package copies, but neither
 * target is retained by a caller-held rejection. No closure captures the owners.
 *
 * @param source - Cache whose request was superseded.
 * @param promise - Original load promise used for exact rejection classification.
 */
export const createCacheSupersededError = (source: object, promise: Promise<void>): Error => {
    const error = new Error('Resource request was superseded before it started');

    error.name = 'AbortError';
    Object.defineProperty(error, Symbol.for('carburetor.cache.superseded.v2'), {
        value: Object.freeze({source: new WeakRef(source), promise: new WeakRef(promise)}),
    });

    return error;
};
