import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {escapeCacheKey} from '@/Carburetor/Resource/Cache/escapeCacheKey';

const slowKeyOf = (args: unknown): string => {
    const serialized = JSON.stringify(args === undefined ? null : args);
    if (serialized === undefined) throw new Error('Expected JSON serialization for a resource argument');
    return escapeCacheKey(serialized);
};

describe('ResourceCache primitive key memo', () => {
    test('a hot primitive remains warm across repeated cold misses within a bounded LRU', () => {
        const cache = new ResourceCache<unknown, string>(async () => undefined, {keyCacheSize: 2});
        const stringify = rstest.spyOn(JSON, 'stringify');
        try {
            const hotKey = cache.keyOf('hot');
            for (let index = 0; index < 8; index++) {
                cache.keyOf(`cold-${index}`);
                expect(cache.keyOf('hot')).toBe(hotKey);
            }
            expect(stringify).toHaveBeenCalledTimes(9);
        } finally {
            stringify.mockRestore();
        }
    });

    test('capacity one evicts the least-recent key and capacity zero disables memoization', () => {
        const one = new ResourceCache<unknown, string>(async () => undefined, {keyCacheSize: 1});
        const stringifyOne = rstest.spyOn(JSON, 'stringify');
        try {
            const keyA = one.keyOf('a');
            expect(one.keyOf('a')).toBe(keyA);
            one.keyOf('b');
            expect(one.keyOf('a')).toBe(keyA);
            expect(stringifyOne).toHaveBeenCalledTimes(3);
        } finally {
            stringifyOne.mockRestore();
        }

        const zero = new ResourceCache<unknown, string>(async () => undefined, {keyCacheSize: 0});
        const expected = slowKeyOf('same');
        const stringifyZero = rstest.spyOn(JSON, 'stringify');
        try {
            expect(zero.keyOf('same')).toBe(expected);
            expect(zero.keyOf('same')).toBe(expected);
            expect(stringifyZero).toHaveBeenCalledTimes(2);
        } finally {
            stringifyZero.mockRestore();
        }
    });

    test('head and middle hits move to the tail before bounded eviction', () => {
        const cache = new ResourceCache<unknown, string>(async () => undefined, {keyCacheSize: 3});
        const stringify = rstest.spyOn(JSON, 'stringify');
        try {
            const keyA = cache.keyOf('a');
            const keyB = cache.keyOf('b');
            const keyC = cache.keyOf('c');
            expect(cache.keyOf('a')).toBe(keyA);
            expect(cache.keyOf('c')).toBe(keyC);

            cache.keyOf('d');
            expect(cache.keyOf('a')).toBe(keyA);
            expect(cache.keyOf('c')).toBe(keyC);
            expect(cache.keyOf('b')).toBe(keyB);
            expect(stringify).toHaveBeenCalledTimes(5);
        } finally {
            stringify.mockRestore();
        }
    });

    test('capacity two treats primitive zero and undefined as real LRU keys', () => {
        const cache = new ResourceCache<unknown, number | string | undefined>(
            async () => undefined, {keyCacheSize: 2},
        );
        const expectedZero = slowKeyOf(0);
        const expectedUndefined = slowKeyOf(undefined);
        const stringify = rstest.spyOn(JSON, 'stringify');
        try {
            const zeroKey = cache.keyOf(0);
            const undefinedKey = cache.keyOf(undefined);
            expect(zeroKey).toBe(expectedZero);
            expect(undefinedKey).toBe(expectedUndefined);
            expect(cache.keyOf(0)).toBe(zeroKey);
            cache.keyOf('cold');
            expect(cache.keyOf(undefined)).toBe(undefinedKey);
            expect(cache.keyOf(0)).toBe(zeroKey);
            expect(stringify).toHaveBeenCalledTimes(5);
        } finally {
            stringify.mockRestore();
        }
    });


    test('small capacities preserve special primitive encodings and mutable object arguments', () => {
        const cache = new ResourceCache<unknown,
            string | number | boolean | null | undefined | {id: number}
        >(async () => undefined, {keyCacheSize: 1});
        const edges: Array<string | number | boolean | null | undefined> = [
            null, undefined, NaN, Infinity, -Infinity, -0, 0, true, false, 'text',
        ];
        for (const edge of edges) expect(cache.keyOf(edge)).toBe(slowKeyOf(edge));
        expect(cache.keyOf(null)).toBe(cache.keyOf(undefined));
        expect(cache.keyOf(NaN)).toBe(cache.keyOf(Infinity));
        expect(cache.keyOf(-0)).toBe(cache.keyOf(0));

        const query = {id: 1};
        const errors = rstest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const first = cache.keyOf(query);
            query.id = 2;
            const changed = cache.keyOf(query);
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
            expect(() => new ResourceCache<unknown, number>(async () => undefined, {keyCacheSize}))
                .toThrow(RangeError);
        }
        const accepted = new ResourceCache<number, number>(async id => id, {
            keyCacheSize: Number.MAX_SAFE_INTEGER,
        });
        expect(accepted.keyOf(1)).toBe('1');
        expect(accepted.keyOf(2)).toBe('2');
    });
});
