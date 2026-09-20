/** Only plain objects and arrays are worth wrapping — everything else is passed through. */
export const isTrackable = (value: unknown): value is object => {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === Array.prototype || prototype === null;
};
