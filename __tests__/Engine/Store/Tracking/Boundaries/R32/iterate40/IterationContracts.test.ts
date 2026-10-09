import {createReadProxy} from '@/Carburetor/Store/Tracking/createReadProxy';
import {IS_DEVELOPMENT} from '@/Carburetor/Store/Utils/DevelopmentFlag';

const methods = ['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'reduce'] as const;

/** Calls a view method or its native reference with identical arguments. */
const call = (view: unknown[], method: typeof methods[number], native: boolean, args: unknown[]): unknown =>
    Reflect.apply(native ? Array.prototype[method] : view[method], view, args);

describe('R40-03: callback and fallback contracts', () => {
    for (const method of methods) {
        test(method + ': borrowed methods use dynamic receivers, including null', () => {
            const reads = new Set<string>();
            const owner = createReadProxy([99], path => reads.add(path));
            const fn = owner[method];
            const receiver = {0: 3, 1: 5, length: 2};
            const callback = (...args: unknown[]): unknown => method === 'reduce'
                ? Number(args[0]) + Number(args[1]) : method === 'every' || args[0] === 5;
            const args = [callback, 0];
            expect(Reflect.apply(fn, receiver, args))
                .toEqual(Reflect.apply(Array.prototype[method], receiver, args));
            expect(() => Reflect.apply(fn, null, args)).toThrow(TypeError);
            expect([...reads]).toEqual([]);
        });

        test(method + ': DEVELOPMENT locked elements still pass through get', () => {
            expect(IS_DEVELOPMENT).toBe(true);
            const raw = [{title: 'locked'}];
            Object.defineProperty(raw, '0', {writable: false, configurable: false});
            expect(Object.isExtensible(raw)).toBe(true);
            const reads = new Set<string>();
            const view = createReadProxy(raw, path => reads.add(path));
            expect(() => call(view, method, false, [() => false, 0]))
                .toThrow('cannot wrap "0"');
            expect([...reads].sort()).toEqual(['0.~p', 'length']);
        });
    }

    for (const method of ['map', 'filter'] as const) {
        test(method + ': own constructor and global species overrides keep native results', () => {
            class Result extends Array<number> {}
            for (const customization of ['own', 'global']) {
                const descriptor = Object.getOwnPropertyDescriptor(Array, Symbol.species)!;
                try {
                    const raw = [1, 2];
                    if (customization === 'own') {
                        Object.defineProperty(raw, 'constructor', {
                            value: {[Symbol.species]: Result}, configurable: true,
                        });
                    } else {
                        Object.defineProperty(Array, Symbol.species, {value: Result, configurable: true});
                    }
                    const view = createReadProxy(raw, () => undefined);
                    const result = call(view, method, false, [(n: number) => n]);
                    expect(result).toBeInstanceOf(Result);
                    expect(Array.from(result as number[])).toEqual([1, 2]);
                } finally {
                    Object.defineProperty(Array, Symbol.species, descriptor);
                }
            }
        });
    }

    test('inherited numeric values remain raw and untracked for every callback method', () => {
        const inherited = {title: 'prototype'};
        const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, '1');
        try {
            Object.defineProperty(Array.prototype, '1', {
                value: inherited, writable: true, configurable: true,
            });
            for (const method of methods) {
                const runs = [false, true].map(native => {
                    const reads = new Set<string>();
                    const raw = [1, 2, 3];
                    Reflect.deleteProperty(raw, '1');
                    const view = createReadProxy(raw, path => reads.add(path));
                    const visits: number[] = [];
                    const callback = (...args: unknown[]): boolean => {
                        const offset = method === 'reduce' ? 1 : 0;
                        const index = args[offset + 1] as number;
                        visits.push(index);
                        if (index === 1) expect(args[offset]).toBe(inherited);
                        return method === 'every';
                    };
                    call(view, method, native, [callback, 0]);
                    expect(reads.has('1')).toBe(false);
                    expect(visits).toEqual([0, 1, 2]);
                    return [...reads].sort();
                });
                expect(runs[0]).toEqual(runs[1]);
            }
        } finally {
            if (descriptor) Object.defineProperty(Array.prototype, '1', descriptor);
            else Reflect.deleteProperty(Array.prototype, '1');
        }
    });

    for (const method of methods) {
        test(method + ': cached access is stable and records nothing', () => {
            const reads = new Set<string>();
            const view = createReadProxy([1, 2], path => reads.add(path));
            const first = view[method];

            expect(view[method]).toBe(first);
            expect([...reads]).toEqual([]);
            Reflect.apply(first, view, method === 'reduce' ? [(acc: number, n: number) => acc + n, 0] : [() => false]);
            expect(reads.has('length')).toBe(true);
            expect(reads.has('0')).toBe(true);
            expect(reads.has(method)).toBe(false);
        });

        test(method + ': callback receiver, index and view are native-compatible', () => {
            for (const native of [false, true]) {
                const view = createReadProxy([10, 20], () => undefined);
                const context = {token: 'context'};
                const seen: number[] = [];
                function callback(this: unknown, ...args: unknown[]): unknown {
                    const offset = method === 'reduce' ? 1 : 0;
                    expect(this).toBe(method === 'reduce' ? undefined : context);
                    expect(args[offset + 2]).toBe(view);
                    expect(args[offset]).toBe(view[args[offset + 1] as number]);
                    seen.push(args[offset + 1] as number);

                    return method === 'every' || method === 'reduce' ? true : false;
                }

                call(view, method, native, [callback, method === 'reduce' ? 0 : context]);
                expect(seen).toEqual([0, 1]);
            }
        });

        test(method + ': callback errors propagate unchanged at the exact prefix', () => {
            for (const native of [false, true]) {
                const reads = new Set<string>();
                const view = createReadProxy([1, 2, 3], path => reads.add(path));
                const error = new Error('callback sentinel');
                const callback = (): never => { throw error; };
                let caught: unknown;
                try {
                    call(view, method, native, [callback, 0]);
                } catch (failure) {
                    caught = failure;
                }

                expect(caught).toBe(error);
                expect([...reads].sort()).toEqual(['0', 'length']);
            }
        });

        test(method + ': invalid callbacks throw even on empty input', () => {
            for (const native of [false, true]) {
                const reads = new Set<string>();
                const view = createReadProxy([], path => reads.add(path));

                expect(() => call(view, method, native, [null, 0])).toThrow(TypeError);
                expect([...reads]).toEqual(['length']);
            }
        });

        test(method + ': element and callback-view writes remain forbidden', () => {
            for (const native of [false, true]) {
                for (const target of ['element', 'view']) {
                    const raw = [{title: 'a'}];
                    const reads = new Set<string>();
                    const view = createReadProxy(raw, path => reads.add(path));
                    const callback = (...args: unknown[]): never => {
                        const offset = method === 'reduce' ? 1 : 0;
                        if (target === 'element') (args[offset] as {title: string}).title = 'changed';
                        else (args[offset + 2] as unknown[])[0] = null;
                        throw new Error('write unexpectedly accepted');
                    };

                    expect(() => call(view, method, native, [callback, 0])).toThrow('read-only');
                    expect(raw).toEqual([{title: 'a'}]);
                    expect([...reads].sort()).toEqual(['0.~p', 'length']);
                }
            }
        });
    }

    test('reduce without initial value skips holes and passes the view as fourth argument', () => {
        for (const native of [false, true]) {
            const reads = new Set<string>();
            const raw = [1, 2, 3, 4];
            Reflect.deleteProperty(raw, '0');
            Reflect.deleteProperty(raw, '2');
            const view = createReadProxy(raw, path => reads.add(path));
            const calls: number[] = [];
            const result = call(view, 'reduce', native, [
                (acc: number, value: number, index: number, array: number[]): number => {
                    expect(array).toBe(view);
                    calls.push(index);

                    return acc + value;
                },
            ]);

            expect(result).toBe(6);
            expect(calls).toEqual([3]);
            expect([...reads].sort()).toEqual(['0', '1', '2', '3', 'length']);
            const empty: number[] = [];
            empty.length = 3;
            expect(() => call(createReadProxy(empty, () => undefined), 'reduce', native, [() => 0]))
                .toThrow(TypeError);
        }
    });

    test('subclass methods keep native species and the trap fallback', () => {
        class Rows extends Array<number> {}
        for (const method of methods) {
            const raw = new Rows(1, 2);
            const reads = new Set<string>();
            const view = createReadProxy(raw, path => reads.add(path));

            expect(view[method]).toBe(Array.prototype[method]);
            const callback = (): boolean => method === 'every';
            const result = call(view, method, false, [callback, 0]);
            if (method === 'map' || method === 'filter') expect(result).toBeInstanceOf(Rows);
            expect([...reads].sort()).toEqual(['0', '1', 'length']);
        }
    });

    test('own method overrides are returned unchanged with their own-path dependency', () => {
        for (const method of methods) {
            const raw = [1, 2];
            const override = function(this: unknown): unknown { return this; };
            Object.defineProperty(raw, method, {value: override, configurable: true});
            const reads = new Set<string>();
            const view = createReadProxy(raw, path => reads.add(path));

            expect(view[method]).toBe(override);
            expect(call(view, method, false, [])).toBe(view);
            expect([...reads]).toEqual([method]);
        }
    });
});
