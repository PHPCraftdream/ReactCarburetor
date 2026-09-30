// History endpoints have already been privately owned. Compare both values and their alias
// topology: a pair visited through a different route is a change even when leaves match.
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;

/** Compares privately owned values, descriptors and alias topology without invoking accessors.
 *
 * @param left - the saved before graph
 * @param right - the current owned graph
 */
export const sameHistoryGraph = (left: unknown, right: unknown): boolean => {
    const forward = new WeakMap<object, object>();
    const backward = new WeakMap<object, object>();
    const equal = (a: unknown, b: unknown): boolean => {
        if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
            return Object.is(a, b);
        }
        if (forward.has(a) || backward.has(b)) {
            return forward.get(a) === b && backward.get(b) === a;
        }
        const prototype = Object.getPrototypeOf(a);
        if (prototype !== Object.getPrototypeOf(b) || Array.isArray(a) !== Array.isArray(b)) {
            return false;
        }
        forward.set(a, b);
        backward.set(b, a);
        if (prototype === Map.prototype && a instanceof Map && b instanceof Map) {
            if (mapSize.call(a) !== mapSize.call(b)) return false;
            const rightEntries = Map.prototype.entries.call(b);
            for (const [key, value] of Map.prototype.entries.call(a) as Iterable<[unknown, unknown]>) {
                const next = rightEntries.next();
                if (next.done || !equal(key, next.value[0]) || !equal(value, next.value[1])) return false;
            }
        } else if (prototype === Set.prototype && a instanceof Set && b instanceof Set) {
            if (setSize.call(a) !== setSize.call(b)) return false;
            const rightValues = Set.prototype.values.call(b);
            for (const member of Set.prototype.values.call(a) as Iterable<unknown>) {
                const next = rightValues.next();
                if (next.done || !equal(member, next.value)) return false;
            }
        } else if (prototype === Date.prototype && a instanceof Date && b instanceof Date) {
            if (!Object.is(Date.prototype.getTime.call(a), Date.prototype.getTime.call(b))) return false;
        } else if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
            return false;
        }
        const keys = Reflect.ownKeys(a);
        const otherKeys = Reflect.ownKeys(b);
        if (keys.length !== otherKeys.length) return false;
        for (let index = 0; index < keys.length; index++) {
            if (keys[index] !== otherKeys[index]) return false;
            const first = Object.getOwnPropertyDescriptor(a, keys[index]);
            const second = Object.getOwnPropertyDescriptor(b, keys[index]);
            if (!first || !second || first.configurable !== second.configurable ||
                first.enumerable !== second.enumerable || first.writable !== second.writable ||
                !('value' in first) || !('value' in second) || !equal(first.value, second.value)) {
                return false;
            }
        }
        return true;
    };
    return equal(left, right);
};
