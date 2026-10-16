/** A custom key result must encode as one cache key: a finite number or a string. */
export const checkResourceKeyValue = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    throw new TypeError('resource key must return a finite number or a string');
};
