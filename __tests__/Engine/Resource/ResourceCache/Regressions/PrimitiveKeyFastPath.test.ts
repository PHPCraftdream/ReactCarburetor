import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";
import {escapeCacheKey} from "@/Carburetor/Resource/Cache/escapeCacheKey";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

interface IUser {
    id: number;
}

const slowKeyOf = (args: unknown): string =>
    escapeCacheKey(JSON.stringify(args === undefined ? null : args) as string);

describe('ResourceCache primitive-args fast path (R30-08)', () => {
    test('fast-path keys match the slow derivation byte for byte on edge values', () => {
        const cache = new ResourceCache<IUser, number | string | boolean | null | undefined>(
            async () => ({id: 0}),
        );

        // -0 and 0 share one entry; NaN, Infinity encode like JSON.stringify does.
        const edges: Array<number | string | boolean | null | undefined> = [
            0, -0, NaN, Infinity, -Infinity, 42, 1e21, 1.5,
            '', 'a', 'a.b', 'x~y', 'a~1b', '"quoted"', '.', '~', 'ü😀', 'null', '0',
            true, false, null, undefined,
        ];

        for (const edge of edges) {
            expect(cache.keyOf(edge)).toEqual(slowKeyOf(edge));
            expect(cache.keyOf(edge)).toEqual(cache.keyOf(edge));
            expect(cache.pathOf(edge)).toEqual(joinPath('entries', slowKeyOf(edge)));
        }
    });

    test('object arguments keep the ordinary key derivation', () => {
        const cache = new ResourceCache<IUser, {id: number}>(async () => ({id: 0}));

        expect(cache.keyOf({id: 1})).toEqual(slowKeyOf({id: 1}));
        expect(cache.keyOf({id: 1})).toEqual(slowKeyOf({id: 1}));
        expect(cache.keyOf({id: 2})).toEqual(slowKeyOf({id: 2}));
    });

    test('resolve() answers with the same key, path and view as the slow trio', async () => {
        const cache = new ResourceCache<IUser, number>(async id => ({id}));

        void cache.load(7);
        await flush();

        const key = slowKeyOf(7);
        const first = cache.resolve(7);
        const second = cache.resolve(7);

        expect(first.key).toEqual(key);
        expect(first.path).toEqual(cache.pathOfKey(key));
        expect(second.key).toEqual(first.key);
        expect(second.path).toEqual(first.path);
        expect(second.view).toBe(first.view);
        expect(first.view.data).toEqual({id: 7});
    });

    test('ttl Infinity never reads the clock on the read path', async () => {
        const cache = new ResourceCache<IUser, number>(async id => ({id}), {ttl: Infinity});

        void cache.load(1);
        await flush();

        let clockCalls = 0;
        const realNow = Date.now;

        Date.now = () => {
            clockCalls += 1;

            return realNow();
        };

        try {
            cache.resolve(1);
            cache.getEntry(1);
            cache.getFailure(1);
        } finally {
            Date.now = realNow;
        }

        expect(clockCalls).toEqual(0);
    });

    test('a finite maxEntries still keeps read entries in LRU order', async () => {
        const cache = new ResourceCache<IUser, string>(async id => ({id}), {maxEntries: 2});

        void cache.load('a');
        void cache.load('b');
        await flush();

        // Reading 'a' makes it the most recent: the next load must evict 'b', not 'a'.
        cache.getEntry('a');

        void cache.load('c');
        await flush();

        expect(cache.getEntry('a').data).toEqual({id: 'a'});
        expect(cache.getEntry('b').data).toEqual(undefined);
        expect(cache.getEntry('c').data).toEqual({id: 'c'});
    });
});
