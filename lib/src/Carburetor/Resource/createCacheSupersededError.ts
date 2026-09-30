/** A cache request cancelled before its loader runs cannot produce an answer. */
export const createCacheSupersededError = (): Error => {
    const error = new Error('Resource request was superseded before it started');

    error.name = 'AbortError';

    return error;
};
