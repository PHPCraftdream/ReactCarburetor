import {Carburetor} from '@/Carburetor';

interface IData {
    tick: number;
    n: number;
    mode: 'scalar' | 'flat' | 'nested' | 'cycle' | 'null' | 'plain' | 'reverse';
    items: Array<number | undefined>;
    hole: boolean;
    zero: number;
    value: number;
}

class FlatStore extends Carburetor<IData> {
    public change = (fn: (draft: IData) => void): void => { this.update(fn); };
}

describe('flat selection patching boundaries (R38)', () => {
    test('fresh flat projections remain quiet on equal tick and publish changed values', () => {
        const store = new FlatStore({tick: 0, n: 1, mode: 'flat', items: [], hole: true, zero: 0, value: 5});
        const objects: Array<{readonly n: number}> = [];
        const tuples: Array<readonly number[]> = [];
        const stopObject = store.watch(d => ({n: d.n, tick: void d.tick}), next => objects.push(next));
        const stopTuple = store.watch(d => [d.n, d.value, void d.tick], next => tuples.push(next));
        store.change(d => { d.tick++; });
        expect(objects).toHaveLength(0);
        expect(tuples).toHaveLength(0);
        store.change(d => { d.n = 2; });
        expect(objects.map(x => x.n)).toEqual([2]);
        expect(tuples).toEqual([[2, 5, undefined]]);
        store.change(d => { d.tick++; });
        expect(objects).toHaveLength(1);
        expect(tuples).toHaveLength(1);
        stopObject(); stopTuple();
    });

    test('direct sparse projection preserves holes, non-enumerable indices, and delivers every transition', () => {
        const store = new FlatStore({tick: 0, n: 0, mode: 'flat', items: [], hole: true, zero: 0, value: 3});
        const arrays: ReadonlyArray<number | undefined>[] = [];
        const tuples: Array<readonly number[]> = [];
        const stopArray = store.watch(d => {
            void d.tick;
            const out: number[] = [];
            out.length = 4;
            out[0] = d.n;
            if (d.hole) Reflect.deleteProperty(out, '1');
            else out[1] = undefined;
            Object.defineProperty(out, '2', {value: d.value, enumerable: false, writable: true, configurable: true});
            return out;
        }, next => arrays.push(next));
        const stopTuple = store.watch(d => [d.zero, d.value, void d.tick] as const, next => tuples.push(next));
        store.change(d => { d.tick++; });
        expect(arrays).toHaveLength(0);
        expect(tuples).toHaveLength(0);
        store.change(d => { d.n = 2; });
        expect(arrays).toHaveLength(1);
        expect(Object.hasOwn(arrays[0], 1)).toBe(false);
        expect(Object.getOwnPropertyDescriptor(arrays[0], '2')?.enumerable).toBe(false);
        expect(arrays[0][2]).toBe(3);
        expect(arrays[0][0]).toBe(2);
        store.change(d => { d.hole = false; });
        expect(arrays).toHaveLength(2);
        expect(Object.hasOwn(arrays[1], 1)).toBe(true);
        expect(arrays[1][1]).toBeUndefined();
        store.change(d => { d.hole = true; });
        expect(arrays).toHaveLength(3);
        expect(Object.hasOwn(arrays[2], 1)).toBe(false);
        expect(arrays[2][2]).toBe(3);
        store.change(d => { d.zero = -0; });
        expect(tuples).toHaveLength(1);
        expect(Object.is(tuples[0][0], -0)).toBe(true);
        store.change(d => { d.value = 5; });
        expect(arrays).toHaveLength(4);
        expect(arrays[3][2]).toBe(5);
        expect(tuples).toHaveLength(2);
        expect(Object.is(tuples[1][0], -0)).toBe(true);
        expect(tuples[1][1]).toBe(5);
        expect(tuples[1][2]).toBeUndefined();
        store.change(d => { d.tick++; });
        expect(arrays).toHaveLength(4);
        expect(tuples).toHaveLength(2);
        stopArray(); stopTuple();
    });

    test('prototype, own __proto__, and reversed key order are observable boundaries', () => {
        const store = new FlatStore({tick: 0, n: 0, mode: 'null', items: [], hole: true, zero: 0, value: 1});
        const seen: Array<{
            keys: string[]; proto: object | null; previousProto: object | null;
            own: boolean; first: number; second: number;
        }> = [];
        const stop = store.watch(d => {
            if (d.mode === 'null') {
                void d.tick;
                const out = Object.create(null) as {first: number; second: number; __proto__: number};
                Object.defineProperty(out, '__proto__', {
                    value: 7, enumerable: true, configurable: true, writable: true,
                });
                out.first = 1;
                out.second = 2;
                return out;
            }
            if (d.mode === 'reverse') {
                void d.tick;
                return {second: 2, first: 1, ['__proto__']: 7} as {
                    first: number; second: number; __proto__: number;
                };
            }
            void d.tick;
            const out = {first: 1, second: 2} as {
                first: number; second: number; __proto__?: number;
            };
            Object.defineProperty(out, '__proto__', {
                value: 7, enumerable: true, configurable: true, writable: true,
            });
            return out;
        }, (next, previous) => seen.push({
            keys: Object.keys(next), proto: Object.getPrototypeOf(next),
            previousProto: Object.getPrototypeOf(previous), own: Object.hasOwn(next, '__proto__'),
            first: next.first, second: next.second,
        }));
        store.change(d => { d.tick++; });
        expect(seen).toHaveLength(0);
        store.change(d => { d.mode = 'plain'; });
        expect(seen).toHaveLength(1);
        expect(seen[0].proto).toBe(Object.prototype);
        expect(seen[0].previousProto).toBe(null);
        expect(seen[0].own).toBe(true);
        store.change(d => { d.mode = 'reverse'; });
        expect(seen).toHaveLength(2);
        expect(seen[1].keys).toEqual(['second', 'first', '__proto__']);
        expect(seen[1].own).toBe(true);
        expect(seen[1].first).toBe(1);
        stop();
    });

    test('selector kind transitions retain dependencies and equal ticks stay quiet', () => {
        const store = new FlatStore({tick: 0, n: 1, mode: 'scalar', items: [], hole: true, zero: 0, value: 0});
        const seen: unknown[] = [];
        const stop = store.watch(d => {
            void d.tick;
            if (d.mode === 'scalar') return d.n;
            if (d.mode === 'flat') return {n: d.n, tick: void d.tick};
            if (d.mode === 'nested') return {child: {n: d.n}, tick: void d.tick};
            const cycle: {n: number; self?: unknown; tick: undefined} = {n: d.n, tick: void d.tick};
            cycle.self = cycle;
            return cycle;
        }, next => seen.push(next));
        store.change(d => { d.tick++; });
        expect(seen).toHaveLength(0);
        store.change(d => { d.mode = 'flat'; });
        expect(seen[0]).toEqual({n: 1, tick: undefined});
        store.change(d => { d.n = 2; });
        expect(seen[1]).toEqual({n: 2, tick: undefined});
        store.change(d => { d.mode = 'nested'; });
        expect(seen[2]).toEqual({child: {n: 2}, tick: undefined});
        store.change(d => { d.n = 3; });
        expect(seen[3]).toEqual({child: {n: 3}, tick: undefined});
        store.change(d => { d.mode = 'cycle'; });
        expect((seen[4] as {n: number}).n).toBe(3);
        store.change(d => { d.n = 4; });
        expect((seen[5] as {n: number}).n).toBe(4);
        store.change(d => { d.tick++; });
        expect(seen).toHaveLength(6);
        stop();
    });
});
