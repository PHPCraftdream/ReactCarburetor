import {liveViews} from '@/Carburetor/Store/Tracking/Proxy/liveViews';

type TOwnedTrait = 'exotic' | 'lockedArray' | 'restricted';

/** Owns a supported graph in one pass; native members and read views share the cycle ledger.
 *
 * @param value - authoritative graph to detach.
 * @param classify - records replay capability traits during ownership.
 */
export const ownHistoryGraph = <V>(value: V, classify?: (trait: TOwnedTrait) => void): V => {
    const seen = new WeakMap<object, object>();
    const copy = (source: unknown): unknown => {
        if (source === null || typeof source !== 'object') return source;
        const raw = liveViews.readTarget(source) ?? source;
        const previous = seen.get(raw);
        if (previous !== undefined) return previous;
        const prototype = Object.getPrototypeOf(raw);
        const array = Array.isArray(raw);
        let result: object;
        let native = false;
        if (prototype === Map.prototype && raw instanceof Map) {
            classify?.('exotic');
            const map = new Map<unknown, unknown>();
            result = map;
            native = true;
            seen.set(raw, result);
            Map.prototype.forEach.call(raw, (member: unknown, key: unknown): void => {
                map.set(copy(key), copy(member));
            });
        } else if (prototype === Set.prototype && raw instanceof Set) {
            classify?.('exotic');
            const set = new Set<unknown>();
            result = set;
            native = true;
            seen.set(raw, result);
            Set.prototype.forEach.call(raw, (member: unknown): void => { set.add(copy(member)); });
        } else if (prototype === Date.prototype && raw instanceof Date) {
            classify?.('exotic');
            result = new Date(Date.prototype.getTime.call(raw));
            native = true;
            seen.set(raw, result);
        } else if (prototype === Object.prototype || prototype === null || prototype === Array.prototype) {
            if (!array && prototype === Array.prototype) classify?.('exotic');
            result = array
                ? (prototype === Array.prototype ? [] : Object.setPrototypeOf([], prototype))
                : (prototype === Object.prototype ? {} : Object.create(prototype));
            seen.set(raw, result);
        } else {
            throw new Error('CarburetorHistory: cannot own a mutable class instance in a history endpoint');
        }
        let length: PropertyDescriptor | undefined;
        for (const key of Reflect.ownKeys(raw)) {
            const descriptor = Object.getOwnPropertyDescriptor(raw, key);
            if (!descriptor) continue;
            if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                throw new Error('CarburetorHistory: cannot snapshot accessor property ' + String(key));
            }
            if (array && key === 'length') {
                // Other indices must be installed before a non-writable length.
                if (descriptor.writable === false) classify?.('lockedArray');
                length = descriptor;
                continue;
            }
            if (!native && (descriptor.writable === false || descriptor.configurable === false)) {
                classify?.('restricted');
            }
            descriptor.value = copy(descriptor.value);
            const target = result as Record<string | symbol, unknown>;
            if (!native && descriptor.writable && descriptor.enumerable &&
                descriptor.configurable && !(key in target)) {
                target[key] = descriptor.value;
            } else {
                Object.defineProperty(result, key, descriptor);
            }
        }
        if (length) Object.defineProperty(result, 'length', length);
        return result;
    };
    return copy(value) as V;
};
