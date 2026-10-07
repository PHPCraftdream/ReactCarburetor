import {viewKeys} from '@/Carburetor/Store/Tracking/Models';

type TFlatResult = {value: unknown} | undefined;

const isArrayIndex = (key: string): boolean => {
    const index = Number(key);
    return String(index) === key && Number.isInteger(index) && index >= 0 && index < 0xFFFFFFFF;
};

/** Detach and compare one-level plain containers containing only primitive own values.
 *
 * @param previous - the prior detached selection, if any.
 * @param fresh - the selector's current value.
 */
export const reconcileFlatSelection = (previous: unknown, fresh: unknown): TFlatResult => {
    if (fresh === null || typeof fresh !== 'object') return undefined;
    const array = Array.isArray(fresh);
    const proto = Object.getPrototypeOf(fresh);
    if (array
        ? proto !== Array.prototype && proto !== Object.prototype && proto !== null
        : proto !== Object.prototype && proto !== null) return undefined;

    const keys = (array
        ? Reflect.ownKeys(fresh).filter((key): key is string => typeof key === 'string' && isArrayIndex(key))
        : viewKeys(fresh).filter((key): key is string => typeof key === 'string'));
    const values: unknown[] = [];
    const descriptors: PropertyDescriptor[] = [];
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(fresh, key);
        if (!descriptor || !('value' in descriptor)) return undefined;
        const value = Reflect.get(fresh, key);
        if (value !== null && (typeof value === 'object' || typeof value === 'function')) return undefined;
        values.push(value);
        descriptors.push(descriptor);
    }

    const sameValues = (old: object): boolean => {
        for (let index = 0; index < keys.length; index++) {
            const descriptor = Object.getOwnPropertyDescriptor(old, keys[index]);
            if (!descriptor || !('value' in descriptor)
                || !Object.is(values[index], Reflect.get(old, keys[index]))) return false;
        }
        return true;
    };
    const define = (result: object): void => {
        for (let index = 0; index < keys.length; index++) {
            const property = array && !descriptors[index].enumerable
                ? descriptors[index] : undefined;
            Object.defineProperty(result, keys[index], {
                value: values[index], writable: property?.writable ?? true,
                enumerable: property?.enumerable ?? true, configurable: property?.configurable ?? true,
            });
        }
    };

    if (array) {
        const length = Reflect.get(fresh, 'length') as number;
        if (Array.isArray(previous) && Object.getPrototypeOf(previous) === proto
            && Reflect.get(previous, 'length') === length) {
            const oldKeys = Reflect.ownKeys(previous).filter(
                (key): key is string => typeof key === 'string' && isArrayIndex(key)
            );
            if (oldKeys.length === keys.length && oldKeys.every((key, index) => key === keys[index])
                && sameValues(previous)) return {value: previous};
        }
        const result: unknown[] = [];
        result.length = length;
        Object.setPrototypeOf(result, proto);
        define(result);
        return {value: result};
    }

    if (previous !== null && typeof previous === 'object' && !Array.isArray(previous)
        && Object.getPrototypeOf(previous) === proto) {
        const oldKeys = viewKeys(previous);
        if (oldKeys.length === keys.length && oldKeys.every((key, index) => key === keys[index])
            && sameValues(previous)) return {value: previous};
    }

    const result = Object.create(proto) as Record<string, unknown>;
    define(result);
    return {value: result};
};
