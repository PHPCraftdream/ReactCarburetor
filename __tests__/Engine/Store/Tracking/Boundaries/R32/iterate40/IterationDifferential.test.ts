import {createReadProxy} from '@/Carburetor/Store/Tracking/createReadProxy';

type Method = 'map' | 'filter' | 'forEach' | 'some' | 'every' | 'find' | 'findIndex' | 'reduce';
const methods: Method[] = ['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'reduce'];

/** Invokes either the view method or the native trap-path reference. */
const invoke = (view: unknown[], method: Method, native: boolean, callback: Function, initial?: unknown): unknown => {
    const fn = (native ? Array.prototype[method] : view[method]) as Function;

    return Reflect.apply(fn, view, method === 'reduce' ? [callback, initial] : [callback]);
};

/** Reads a representative leaf or structure without inspecting result proxies afterwards. */
const label = (value: unknown): string => {
    if (Array.isArray(value)) return 'array:' + value.length + ':' + Object.keys(value).join(',');
    if (value instanceof Map) return 'map:' + value.size;
    if (value instanceof Set) return 'set:' + value.size;
    if (value instanceof Date) return 'date:' + value.getTime();
    if (value !== null && typeof value === 'object') {
        return 'object:' + (value as {title: string}).title + ':' + Object.keys(value).join(',');
    }

    return String(value);
};

const fixtures = [
    {name: 'primitives', raw: [2, 4], labels: ['2', '4'], paths: ['rows.0', 'rows.1']},
    {name: 'objects', raw: [{title: 'a'}, {title: 'b'}], labels: ['object:a:title', 'object:b:title'],
        paths: ['rows.0.~p', 'rows.0.title', 'rows.0.~k', 'rows.1.~p', 'rows.1.title', 'rows.1.~k']},
    {name: 'holes', raw: Object.assign([], {1: 7, length: 3}), labels: ['undefined', '7', 'undefined'],
        paths: ['rows.0', 'rows.1', 'rows.2']},
    {name: 'empty', raw: [], labels: [], paths: []},
    {name: 'null and undefined', raw: [null, undefined], labels: ['null', 'undefined'],
        paths: ['rows.0', 'rows.1']},
    {name: 'arrays', raw: [[1], []], labels: ['array:1:0', 'array:0:'],
        paths: ['rows.0.~p', 'rows.0.length', 'rows.0.~k', 'rows.1.~p', 'rows.1.length', 'rows.1.~k']},
    {name: 'native instances', raw: [new Map([['a', 1]]), new Set([2]), new Date(0)],
        labels: ['map:1', 'set:1', 'date:0'], paths: ['rows.0', 'rows.1', 'rows.2']},
];

describe('R40-03: iteration matches the native trap path', () => {
    for (const method of ['map', 'filter'] as const) {
        for (const prototype of [Array.prototype, Object.prototype]) {
            for (const kind of ['setter', 'nonwritable']) {
                test(method + ': numeric ' + (prototype === Array.prototype ? 'Array' : 'Object') +
                    ' prototype ' + kind + ' preserves CreateDataProperty', () => {
                    const reads = new Set<string>();
                    const nativeReads = new Set<string>();
                    const view = createReadProxy([2, 4, 6], path => reads.add(path));
                    const nativeView = createReadProxy([2, 4, 6], path => nativeReads.add(path));
                    // Cache before pollution: the guard must run on invocation, not method lookup.
                    const cached = view[method];
                    const descriptor = Object.getOwnPropertyDescriptor(prototype, '1');
                    let setterCalls = 0;
                    let result: unknown;
                    let nativeResult: unknown;
                    const callback = (value: number): number | boolean => method === 'map' ? value * 2 : value > 2;
                    try {
                        Object.defineProperty(prototype, '1', kind === 'setter'
                            ? {configurable: true, set: () => { setterCalls++; }}
                            : {configurable: true, writable: false, value: 99});
                        result = Reflect.apply(cached, view, [callback]);
                        nativeResult = Reflect.apply(Array.prototype[method], nativeView, [callback]);
                    } finally {
                        if (descriptor) Object.defineProperty(prototype, '1', descriptor);
                        else Reflect.deleteProperty(prototype, '1');
                    }
                    // rstest itself uses arrays: never assert while numeric prototypes are polluted.
                    expect(setterCalls).toBe(0);
                    expect(result).toEqual(nativeResult);
                    expect(result).toEqual(method === 'map' ? [4, 8, 12] : [4, 6]);
                    expect(Object.getOwnPropertyDescriptor(result, '1')).toEqual({
                        value: method === 'map' ? 8 : 6, writable: true, enumerable: true, configurable: true,
                    });
                    expect([...reads].sort()).toEqual([...nativeReads].sort());
                });
            }
        }
    }

    for (const method of methods) {
        for (const mutation of ['grow', 'shrink', 'presence']) {
            test(method + ': raw ' + mutation + ' keeps captured length and live presence', () => {
                const runs = [false, true].map(native => {
                    const raw = [1, 2, 3, 4];
                    Reflect.deleteProperty(raw, '2');
                    const reads = new Set<string>();
                    const view = createReadProxy(raw, path => reads.add(path));
                    const visits: Array<[number, unknown]> = [];
                    const visit = (value: unknown, index: number, array: unknown[]): boolean => {
                        expect(array).toBe(view);
                        visits.push([index, value]);
                        if (index === 0) {
                            if (mutation === 'grow') raw.push(5, 6);
                            else if (mutation === 'shrink') raw.length = 1;
                            else {
                                Reflect.deleteProperty(raw, '1');
                                raw[2] = 30;
                            }
                        }
                        return method === 'every';
                    };
                    const callback = method === 'reduce'
                        ? (acc: number, value: unknown, index: number, array: unknown[]): number => {
                            visit(value, index, array);
                            return acc + 1;
                        } : visit;
                    const result = invoke(view, method, native, callback, 0);
                    const holesVisited = method === 'find' || method === 'findIndex';
                    const expected = mutation === 'grow' ? (holesVisited ? [0, 1, 2, 3] : [0, 1, 3])
                        : mutation === 'shrink' ? (holesVisited ? [0, 1, 2, 3] : [0])
                        : holesVisited ? [0, 1, 2, 3] : [0, 2, 3];
                    expect(visits.map(([index]) => index)).toEqual(expected);
                    if (method === 'map') expect((result as unknown[]).length).toBe(4);
                    expect([...reads].sort()).toEqual(['0', '1', '2', '3', 'length']);
                    return {result, visits, reads: [...reads].sort()};
                });
                expect(runs[0]).toEqual(runs[1]);
            });
        }
    }

    for (const method of methods) {
        for (const fixture of fixtures) {
            test(method + ': ' + fixture.name + ' has exact results, visits and read sets', () => {
                const runs = [false, true].map(native => {
                    const reads = new Set<string>();
                    const view = createReadProxy({rows: fixture.raw}, path => reads.add(path)).rows;
                    const visits: Array<[number, string]> = [];
                    const visit = (value: unknown, index: number, array: unknown[]): string => {
                        expect(array).toBe(view);
                        const text = label(value);
                        visits.push([index, text]);

                        return text;
                    };
                    const callback = method === 'reduce'
                        ? (acc: string[], value: unknown, index: number, array: unknown[]): string[] =>
                            [...acc, visit(value, index, array)]
                        : (value: unknown, index: number, array: unknown[]): unknown => {
                            const text = visit(value, index, array);

                            return method === 'map' ? text : method === 'every';
                        };
                    const result = invoke(view, method, native, callback, []);
                    const indices = Array.from({length: fixture.raw.length}, (_, index) => index)
                        .filter(index => method === 'find' || method === 'findIndex' || index in fixture.raw);
                    const expectedVisits = indices.map(index => [index, fixture.labels[index]]);
                    const texts = indices.map(index => fixture.labels[index]);
                    const expectedMap: unknown[] = [];
                    expectedMap.length = fixture.raw.length;
                    for (const index of indices) expectedMap[index] = fixture.labels[index];
                    const expected = method === 'map' ? expectedMap
                        : method === 'filter' ? []
                        : method === 'some' ? false
                        : method === 'every' ? true
                        : method === 'findIndex' ? -1
                        : method === 'reduce' ? texts : undefined;

                    expect(visits).toEqual(expectedVisits);
                    expect(result).toEqual(expected);
                    expect([...reads].sort()).toEqual(['rows.~p', 'rows.length', ...fixture.paths].sort());
                    if (method === 'map' && fixture.name === 'holes') {
                        expect(0 in (result as unknown[])).toBe(false);
                        expect(2 in (result as unknown[])).toBe(false);
                    }

                    return {result, visits, reads: [...reads].sort()};
                });

                expect(runs[0]).toEqual(runs[1]);
            });
        }
    }

    for (const method of ['some', 'every', 'find', 'findIndex'] as const) {
        test(method + ': early exit records only the visited prefix', () => {
            for (const native of [false, true]) {
                const reads = new Set<string>();
                const view = createReadProxy({rows: [1, 2, 3]}, path => reads.add(path)).rows;
                const result = invoke(view, method, native,
                    (value: number) => method === 'every' ? value < 2 : value === 2);

                expect(result).toBe(method === 'find' ? 2 : method === 'findIndex' ? 1 : method === 'some');
                expect([...reads].sort()).toEqual(['rows.~p', 'rows.length', 'rows.0', 'rows.1'].sort());
            }
        });
    }

    test('filter/find preserve wrapped element identities and branch-only reads', () => {
        for (const native of [false, true]) {
            const reads = new Set<string>();
            const view = createReadProxy({rows: [{title: 'a'}, {title: 'b'}]}, path => reads.add(path)).rows;
            const first = view[0];
            reads.clear();
            const filtered = invoke(view, 'filter', native, () => true) as unknown[];
            const found = invoke(view, 'find', native, () => true);

            expect(filtered[0]).toBe(first);
            expect(found).toBe(first);
            expect([...reads].sort()).toEqual(['rows.length', 'rows.0.~p', 'rows.1.~p'].sort());
        }
    });
});
