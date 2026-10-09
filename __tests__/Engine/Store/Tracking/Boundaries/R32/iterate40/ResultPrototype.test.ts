import {createReadProxy} from '@/Carburetor/Store/Tracking/createReadProxy';

describe('R40: callback-time result prototype changes', () => {
    for (const method of ['map', 'filter'] as const) {
        for (const prototype of [Array.prototype, Object.prototype]) {
            for (const kind of ['setter', 'nonwritable']) {
                const label = prototype === Array.prototype ? 'Array' : 'Object';
                test(`${method}: ${label} ${kind} installed after guard`, () => {
                    const descriptor = Object.getOwnPropertyDescriptor(prototype, '7');
                    const view = createReadProxy([10, 11, 12, 13, 14, 15, 16, 17, 18, 19], () => undefined);
                    let setterCalls = 0;
                    let result: number[] | undefined;
                    let caught: unknown;
                    try {
                        const callback = (value: number, index: number): number | boolean => {
                            if (index === 0) {
                                Object.defineProperty(prototype, '7', kind === 'setter' ? {
                                    set: () => { setterCalls++; }, configurable: true,
                                } : {value: -1, writable: false, configurable: true});
                            }
                            // filter writes compact index 7 while visiting source index 8.
                            return method === 'map' ? value * 2 : index > 0;
                        };
                        result = Reflect.apply(view[method], view, [callback]) as number[];
                    } catch (error) {
                        caught = error;
                    } finally {
                        if (descriptor) Object.defineProperty(prototype, '7', descriptor);
                        else Reflect.deleteProperty(prototype, '7');
                    }

                    expect(caught).toBeUndefined();
                    expect(setterCalls).toBe(0);
                    expect(result).toEqual(method === 'map'
                        ? [20, 22, 24, 26, 28, 30, 32, 34, 36, 38]
                        : [11, 12, 13, 14, 15, 16, 17, 18, 19]);
                    expect(Object.getPrototypeOf(result)).toBe(Array.prototype);
                    expect(Object.getOwnPropertyDescriptor(result!, '7')).toEqual({
                        value: method === 'map' ? 34 : 18,
                        writable: true, enumerable: true, configurable: true,
                    });
                });
            }
        }

        test(`${method}: restoration uses module-captured intrinsics`, () => {
            const intrinsicArray = Array;
            const intrinsicPrototype = Array.prototype;
            const setPrototypeOf = Object.setPrototypeOf;
            const view = createReadProxy([1], () => undefined);
            let result: number[] | undefined;
            let caught: unknown;
            let patchedCalls = 0;
            try {
                result = Reflect.apply(view[method], view, [() => {
                    globalThis.Array = class Replacement extends intrinsicArray {} as ArrayConstructor;
                    Object.setPrototypeOf = () => { patchedCalls++; throw new Error('patched intrinsic'); };
                    return 2;
                }]) as number[];
            } catch (error) {
                caught = error;
            } finally {
                globalThis.Array = intrinsicArray;
                Object.setPrototypeOf = setPrototypeOf;
            }

            expect(caught).toBeUndefined();
            expect(patchedCalls).toBe(0);
            expect(Object.getPrototypeOf(result)).toBe(intrinsicPrototype);
            expect(result).toEqual(method === 'map' ? [2] : [1]);
        });
    }
});
