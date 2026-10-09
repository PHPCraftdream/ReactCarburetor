import {iterateArrayCallback} from './iterateArrayCallback';

interface IReadHandler {
    proxy: object | undefined;
    get(source: object, key: string, receiver: unknown): unknown;
    has(source: object, key: string): boolean;
}

const natives = new Map<string, Function>([
    ['map', Array.prototype.map], ['filter', Array.prototype.filter],
    ['forEach', Array.prototype.forEach], ['some', Array.prototype.some],
    ['every', Array.prototype.every], ['find', Array.prototype.find],
    ['findIndex', Array.prototype.findIndex], ['reduce', Array.prototype.reduce],
]);
const speciesGetter = Object.getOwnPropertyDescriptor(Array, Symbol.species)?.get;

/** Cached callback methods only; indexOf/includes retain native proxy-value identity semantics. */
export class ArrayCallbackMethods {
    /** Stable methods belonging to this read view. */
    private readonly methods = new Map<string, Function>();

    /**
     * Only ordinary arrays with the original inherited method are eligible.
     * The caller has already established that source is an array and key is inherited.
     *
     * @param source - Array target.
     * @param key - Requested method name.
     * @param value - Resolved method value.
     */
    static supports(source: object, key: string, value: unknown): boolean {
        const native = natives.get(key);
        return native !== undefined && value === native && Object.getPrototypeOf(source) === Array.prototype;
    }

    /**
     * Creates one dynamic-this method per owning view, never recording method access.
     *
     * @param source - Array target.
     * @param key - Requested method name.
     * @param handler - Owning read handler.
     */
    get(source: object, key: string, handler: IReadHandler): Function {
        let method = this.methods.get(key);
        if (method !== undefined) return method;
        const native = natives.get(key)!;
        method = function(this: unknown, ...args: unknown[]): unknown {
            // Borrowing must not silently use the captured array. Species-sensitive results
            // stay native if constructor/species customization can affect their creation.
            if (this !== handler.proxy || Object.getPrototypeOf(source) !== Array.prototype ||
                ((key === 'map' || key === 'filter') &&
                    (Object.prototype.hasOwnProperty.call(source, 'constructor') ||
                     Object.getOwnPropertyDescriptor(Array.prototype, 'constructor')?.value !== Array ||
                     Object.getOwnPropertyDescriptor(Array, Symbol.species)?.get !== speciesGetter))) {
                return Reflect.apply(native, this, args);
            }
            return iterateArrayCallback(source, key, handler, args);
        };
        this.methods.set(key, method);
        return method;
    }
}
