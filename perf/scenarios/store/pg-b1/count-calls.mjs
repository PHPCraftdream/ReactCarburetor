/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Count only synchronous measured work; always restore the original method.
export const countCalls = (owner, key, work) => {
    const original = owner[key];
    let calls = 0;
    owner[key] = function (...args) { calls++; return original.apply(this, args); };
    try {
        const value = work();
        return {calls, value};
    } finally {
        owner[key] = original;
    }
};
