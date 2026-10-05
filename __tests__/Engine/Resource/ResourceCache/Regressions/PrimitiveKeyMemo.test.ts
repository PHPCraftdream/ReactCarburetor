import {TestCache} from '../Helpers/TestCache';
import {escapeCacheKey} from '@/Carburetor/Resource/Cache/escapeCacheKey';

const slowKeyOf = (args: unknown): string => {
    const serialized = JSON.stringify(args === undefined ? null : args);
    if (serialized === undefined) throw new Error('Expected JSON serialization for a resource argument');
    return escapeCacheKey(serialized);
};

describe('ResourceCache primitive key memo', () => {
    test('a hot primitive remains warm across repeated cold misses within a bounded LRU', () => {
        const cache = new TestCache<unknown, string>(async () => undefined, {keyCacheSize: 2});
        const stringify = rstest.spyOn(JSON, 'stringify');
        try {
            const hotKey = cache.exposeKeyOf('hot');
            for (let index = 0; index < 8; index++) {
                cache.exposeKeyOf(`cold-${index}`);
                expect(cache.exposeKeyOf('hot')).toBe(hotKey);
            }
            expect(stringify).toHaveBeenCalledTimes(9);
        } finally {
            stringify.mockRestore();
        }
    });

    test('capacity one evicts the least-recent key and capacity zero disables memoization', () => {
        const one = new TestCache<unknown, string>(async () => undefined, {keyCacheSize: 1});
        const stringifyOne = rstest.spyOn(JSON, 'stringify');
        try {
            const keyA = one.exposeKeyOf('a');
            expect(one.exposeKeyOf('a')).toBe(keyA);
            one.exposeKeyOf('b');
            expect(one.exposeKeyOf('a')).toBe(keyA);
            expect(stringifyOne).toHaveBeenCalledTimes(3);
        } finally {
            stringifyOne.mockRestore();
        }

        const zero = new TestCache<unknown, string>(async () => undefined, {keyCacheSize: 0});
        const expected = slowKeyOf('same');
        const stringifyZero = rstest.spyOn(JSON, 'stringify');
        try {
            expect(zero.exposeKeyOf('same')).toBe(expected);
            expect(zero.exposeKeyOf('same')).toBe(expected);
            expect(stringifyZero).toHaveBeenCalledTimes(2);
        } finally {
            stringifyZero.mockRestore();
        }
    });

    test('head and middle hits move to the tail before bounded eviction', () => {
        const cache = new TestCache<unknown, string>(async () => undefined, {keyCacheSize: 3});
        const stringify = rstest.spyOn(JSON, 'stringify');
        try {
            const keyA = cache.exposeKeyOf('a');
            const keyB = cache.exposeKeyOf('b');
            const keyC = cache.exposeKeyOf('c');
            expect(cache.exposeKeyOf('a')).toBe(keyA);
            expect(cache.exposeKeyOf('c')).toBe(keyC);

            cache.exposeKeyOf('d');
            expect(cache.exposeKeyOf('a')).toBe(keyA);
            expect(cache.exposeKeyOf('c')).toBe(keyC);
            expect(cache.exposeKeyOf('b')).toBe(keyB);
            expect(stringify).toHaveBeenCalledTimes(5);
        } finally {
            stringify.mockRestore();
        }
    });

    test('capacity two treats primitive zero and undefined as real LRU keys', () => {
        const cache = new TestCache<unknown, number | string | undefined>(
            async () => undefined, {keyCacheSize: 2},
        );
        const expectedZero = slowKeyOf(0);
        const expectedUndefined = slowKeyOf(undefined);
        const stringify = rstest.spyOn(JSON, 'stringify');
        try {
            const zeroKey = cache.exposeKeyOf(0);
            const undefinedKey = cache.exposeKeyOf(undefined);
            expect(zeroKey).toBe(expectedZero);
            expect(undefinedKey).toBe(expectedUndefined);
            expect(cache.exposeKeyOf(0)).toBe(zeroKey);
            cache.exposeKeyOf('cold');
            expect(cache.exposeKeyOf(undefined)).toBe(undefinedKey);
            expect(cache.exposeKeyOf(0)).toBe(zeroKey);
            expect(stringify).toHaveBeenCalledTimes(5);
        } finally {
            stringify.mockRestore();
        }
    });


    test('small capacities preserve special primitive encodings and mutable object arguments', () => {
        const cache = new TestCache<unknown,
            string | number | boolean | null | undefined | {id: number}
        >(async () => undefined, {keyCacheSize: 1});
        const edges: Array<string | number | boolean | null | undefined> = [
            null, undefined, NaN, Infinity, -Infinity, -0, 0, true, false, 'text',
        ];
        for (const edge of edges) expect(cache.exposeKeyOf(edge)).toBe(slowKeyOf(edge));
        expect(cache.exposeKeyOf(null)).toBe(cache.exposeKeyOf(undefined));
        expect(cache.exposeKeyOf(NaN)).toBe(cache.exposeKeyOf(Infinity));
        expect(cache.exposeKeyOf(-0)).toBe(cache.exposeKeyOf(0));

        const query = {id: 1};
        const errors = rstest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const first = cache.exposeKeyOf(query);
            query.id = 2;
            const changed = cache.exposeKeyOf(query);
            expect(first).toBe(slowKeyOf({id: 1}));
            expect(changed).toBe(slowKeyOf({id: 2}));
            expect(changed).not.toBe(first);
        } finally {
            errors.mockRestore();
        }
    });

    test('keyCacheSize accepts only non-negative safe integers and rejects Infinity', () => {
        const invalid = [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
        for (const keyCacheSize of invalid) {
            expect(() => new TestCache<unknown, number>(async () => undefined, {keyCacheSize}))
                .toThrow(RangeError);
        }
        const accepted = new TestCache<number, number>(async id => id, {
            keyCacheSize: Number.MAX_SAFE_INTEGER,
        });
        expect(accepted.exposeKeyOf(1)).toBe('1');
        expect(accepted.exposeKeyOf(2)).toBe('2');
    });
});
