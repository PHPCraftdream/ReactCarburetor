/**
 * Whether `value` is a plain object: a non-null, non-array object whose prototype is
 * `Object.prototype` or `null` — the shape a detached selection's members take, and the only
 * shape the selection comparison in `sameSelection` knows how to look inside.
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype: object | null = Object.getPrototypeOf(value);

    return prototype === null || prototype === Object.prototype;
};
