import {TestCache} from '../TestCache';

describe('ResourceCache object key compatibility', () => {
    test('same-reference mutation diagnostics and canonical keys survive primitive traffic', () => {
        const cache = new TestCache<unknown, unknown>(async () => undefined, {keyCacheSize: 2});
        const query = {id: 'a.b~c', filters: [{value: 1}]};
        const reports = rstest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const first = cache.resolve(query);
            expect(cache.resolve(query).key).toBe(first.key);
            for (const primitive of ['cold-a', 0, undefined, 'cold-b', true]) cache.resolve(primitive);
            query.filters[0].value = 2;
            const changed = cache.resolve(query);
            expect(changed.key).not.toBe(first.key);
            expect(changed.key).toBe('{"id":"a~1b~0c","filters":[{"value":2}]}');
            expect(reports).toHaveBeenCalledTimes(1);
            cache.resolve('cold-c');
            query.filters[0].value = 3;
            expect(cache.resolve(query).key).toBe('{"id":"a~1b~0c","filters":[{"value":3}]}');
            expect(reports).toHaveBeenCalledTimes(1);
        } finally {
            reports.mockRestore();
        }
    });

    test('equal fresh objects reuse canonical bytes without a same-reference mutation report', () => {
        const cache = new TestCache<unknown, unknown>(async () => undefined);
        const reports = rstest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const first = cache.resolve({id: 'a.b~c', values: ['~1', '.']});
            const equal = cache.resolve({id: 'a.b~c', values: ['~1', '.']});
            expect(first.key).toBe('{"id":"a~1b~0c","values":["~01","~1"]}');
            expect(equal.key).toBe(first.key);
            expect(equal.path).toBe(`entries.${first.key.replace(/~/g, '~0')}`);
            expect(cache.resolve({id: 'changed'}).key).not.toBe(first.key);
            expect(reports).not.toHaveBeenCalled();
            expect(Object.keys(cache.getData().entries)).toHaveLength(0);
        } finally {
            reports.mockRestore();
        }
    });

    for (const keyCacheSize of [0, 1, 2]) {
        test(`canonical escaped primitive and object bytes survive mixed traffic (budget=${keyCacheSize})`, () => {
            const cache = new TestCache<unknown, unknown>(async () => undefined, {keyCacheSize});
            const cases: Array<[unknown, string]> = [
                ['a.b~c', '"a~1b~0c"'],
                ['~1.~0', '"~01~1~00"'],
                [undefined, 'null'], [null, 'null'], [-0, '0'], [0, '0'],
                [true, 'true'], [false, 'false'],
                [{id: 'a.b~c'}, '{"id":"a~1b~0c"}'],
            ];
            // Non-finite numbers (NaN/Infinity/-Infinity) are rejected in development before
            // derivation, so they no longer participate in byte equality.
            for (const nonFinite of [NaN, Infinity, -Infinity]) {
                expect(() => cache.resolve(nonFinite)).toThrow(TypeError);
                expect(() => cache.exposeKeyOf(nonFinite)).toThrow(TypeError);
            }
            for (let round = 0; round < 2; round++) {
                for (const [argument, key] of cases) {
                    const resolved = cache.resolve(argument);
                    expect(resolved.key).toBe(key);
                    expect(resolved.path).toBe(`entries.${key.replace(/~/g, '~0')}`);
                    expect(cache.exposeKeyOf(argument)).toBe(key);
                    expect(cache.exposePathOf(argument)).toBe(resolved.path);
                    expect(resolved.present).toBe(false);
                }
            }
            expect(Object.keys(cache.getData().entries)).toHaveLength(0);
        });
    }
});
