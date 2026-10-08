import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';

/** R39-05: own changed graph endpoints while retaining proven-equal root siblings and their aliases.
 *
 * @param previous - Current root.
 * @param next - Restore root.
 * @param unchanged - Proven-equal branches. */
export const ownArrayRestore = (
    previous: Record<string, unknown>, next: Record<string, unknown>, unchanged: Map<object, object>
): Record<string, unknown> => {
    const copies = new Map<object, object>();
    const retain = (old: unknown, value: unknown): void => {
        if (!isTrackable(old) || !isTrackable(value) || copies.has(value)) return;
        copies.set(value, old);
        for (const key of Object.keys(value)) {
            retain((old as Record<string, unknown>)[key], (value as Record<string, unknown>)[key]);
        }
    };
    if (!Array.isArray(next)) {
        for (const key of Object.keys(next)) {
            const old = previous[key];
            const value = next[key];
            if (Object.is(old, value) || unchanged.get(old as object) === value) retain(old, value);
        }
    }
    const copy = (value: unknown): unknown => {
        if (!isTrackable(value)) return value;
        const known = copies.get(value);
        if (known !== undefined) return known;
        const prototype = Object.getPrototypeOf(value);
        const result = Array.isArray(value) ? [] : Object.create(prototype);
        if (Array.isArray(value) && prototype !== Array.prototype) Object.setPrototypeOf(result, prototype);
        copies.set(value, result);
        for (const key of Reflect.ownKeys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
            if ('value' in descriptor) descriptor.value = copy(descriptor.value);
            Object.defineProperty(result, key, descriptor);
        }
        return result;
    };
    return copy(next) as Record<string, unknown>;
};
