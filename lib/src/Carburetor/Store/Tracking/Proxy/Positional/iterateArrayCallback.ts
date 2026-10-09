const arrayPrototype = Array.prototype;
const setPrototypeOf = Object.setPrototypeOf;

interface IReadHandler {
    proxy: object | undefined;
    get(source: object, key: string, receiver: unknown): unknown;
    has(source: object, key: string): boolean;
}

/**
 * Native callback iteration with a length snapshot and live presence, using the real get trap.
 *
 * @param source - Array target.
 * @param method - Native callback method name.
 * @param handler - Owning read handler.
 * @param args - Callback and optional receiver or initial accumulator.
 */
export const iterateArrayCallback = (
    source: object, method: string, handler: IReadHandler, args: unknown[]
): unknown => {
    const view = handler.proxy;
    const length = handler.get(source, 'length', view) as number;
    const callback = args[0];
    if (typeof callback !== 'function') throw new TypeError('Array callback must be callable');
    const visitHoles = method === 'find' || method === 'findIndex';
    const result: unknown[] = [];
    const returnsArray = method === 'map' || method === 'filter';
    // Detached once: assignments create own slots even if callbacks change numeric prototypes.
    if (returnsArray) setPrototypeOf(result, null);
    if (method === 'map') result.length = length;
    let outputIndex = 0;
    let accumulator = args[1];
    let initialized = args.length > 1;

    for (let index = 0; index < length; index++) {
        const key = String(index);
        // Presence is live even when a callback mutates the raw reference. Existing own or
        // inherited slots need just get; only holes need has to record the missing path.
        if (!visitHoles && !Reflect.has(source, key)) {
            handler.has(source, key);
            continue;
        }
        const value = handler.get(source, key, view);
        if (method === 'reduce') {
            if (!initialized) {
                accumulator = value;
                initialized = true;
            } else {
                accumulator = Reflect.apply(callback, undefined, [accumulator, value, index, view]);
            }
            continue;
        }
        const selected: unknown = Reflect.apply(callback, args[1], [value, index, view]);
        if (method === 'map') result[index] = selected;
        else if (method === 'filter' && selected) result[outputIndex++] = value;
        if (method === 'some' && selected) return true;
        if (method === 'every' && !selected) return false;
        if (method === 'find' && selected) return value;
        if (method === 'findIndex' && selected) return index;
    }
    if (method === 'reduce') {
        if (!initialized) throw new TypeError('Reduce of empty array with no initial value');
        return accumulator;
    }
    if (returnsArray) {
        setPrototypeOf(result, arrayPrototype);
        return result;
    }
    if (method === 'some') return false;
    if (method === 'every') return true;
    if (method === 'findIndex') return -1;
    return undefined;
};
