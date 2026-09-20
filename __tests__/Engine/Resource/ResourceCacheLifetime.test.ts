import {EResourceStatus, TPath, TPathSet} from "@/Carburetor";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

const makeLoader = () => {
    const calls: string[] = [];
    const settle: ((value: string) => void)[] = [];

    const load = (id: string): Promise<string> => {
        calls.push(id);

        return new Promise<string>(resolve => settle.push(resolve));
    };

    return {calls, settle, load};
};

const flush = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
};

/** Loads several keys and settles them all, leaving a populated cache. */
const fill = async (cache: ResourceCache<string, string>, loader: ReturnType<typeof makeLoader>, keys: string[]) => {
    for (const key of keys) {
        void cache.load(key);
    }

    loader.settle.forEach((resolve, index) => resolve(`value-${keys[index]}`));

    await flush();
};

const readsOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

describe('ResourceCache lifetime', () => {
    test('invalidate marks one entry stale without touching its data', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await fill(cache, loader, ['a', 'b']);

        cache.invalidate('a');

        expect(cache.getEntry('a').stale).toBeTruthy();
        expect(cache.getEntry('a').data).toEqual('value-a');
        // The data is as old as it was; only the verdict changed.
        expect(cache.getEntry('a').updatedAt).toBeDefined();
        expect(cache.getEntry('b').stale).toBeFalsy();
    });

    test('invalidate does not fetch by itself', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await fill(cache, loader, ['a']);
        cache.invalidate('a');

        expect(loader.calls).toEqual(['a']);

        // Asking for it is what fetches, and now it will, because the entry is stale.
        void cache.load('a');

        expect(loader.calls).toEqual(['a', 'a']);
    });

    test('a successful answer clears the invalidation', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await fill(cache, loader, ['a']);
        cache.invalidate('a');

        const request = cache.refresh('a');
        loader.settle[1]('fresh');
        await request;

        expect(cache.getEntry('a').stale).toBeFalsy();
        expect(cache.getEntry('a').data).toEqual('fresh');
    });

    test('invalidateAll marks every entry, which is the move after a write the server took', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await fill(cache, loader, ['a', 'b', 'c']);

        cache.invalidateAll();

        ['a', 'b', 'c'].forEach((key: string) => {
            expect(cache.getEntry(key).stale).toBeTruthy();
            expect(cache.getEntry(key).data).toEqual(`value-${key}`);
        });
    });

    test('invalidating one entry wakes only its readers', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});
        let readerOfA = 0;
        let readerOfB = 0;

        await fill(cache, loader, ['a', 'b']);

        cache.subscribe(() => readerOfA++, {id: 'a', reads: readsOf(`entries.${cache.keyOf('a')}`)});
        cache.subscribe(() => readerOfB++, {id: 'b', reads: readsOf(`entries.${cache.keyOf('b')}`)});

        cache.invalidate('a');

        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);
    });

    test('forget drops an entry and its failure', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        await fill(cache, loader, ['a', 'b']);

        cache.forget('a');

        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getEntry('a').data).toBeUndefined();
        expect(cache.getFailure('a')).toBeUndefined();
        expect(cache.getEntry('b').data).toEqual('value-b');
    });

    test('forget cancels the request, so a late answer cannot resurrect the entry', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        void cache.load('a');
        cache.forget('a');

        loader.settle[0]('too late');
        await flush();

        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getEntry('a').data).toBeUndefined();
    });

    test('forgetAll empties the cache', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        await fill(cache, loader, ['a', 'b', 'c']);

        cache.forgetAll();

        expect(Object.keys(cache.getData().entries)).toEqual([]);
    });

    test('the cache stays within its bound, dropping the least recently used first', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 2, ttl: 60_000});

        await fill(cache, loader, ['a', 'b']);

        // Touching `a` makes `b` the least recently used.
        cache.getEntry('a');

        void cache.load('c');
        loader.settle[2]('value-c');
        await flush();

        const kept = Object.keys(cache.getData().entries);

        expect(kept.length).toEqual(2);
        expect(kept).toContain(cache.keyOf('a'));
        expect(kept).toContain(cache.keyOf('c'));
        expect(kept).not.toContain(cache.keyOf('b'));
    });

    test('use order is exact even when everything happens in the same millisecond', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 2, ttl: 60_000});

        await fill(cache, loader, ['a', 'b']);

        // All of this lands inside one millisecond, which is why order is a counter and not a clock:
        // with timestamps these reads compared equal and eviction dropped the entry just touched.
        cache.getEntry('b');
        cache.getEntry('a');
        cache.getEntry('b');
        cache.getEntry('a');

        void cache.load('c');
        loader.settle[2]('value-c');
        await flush();

        const kept = Object.keys(cache.getData().entries);

        expect(kept).toContain(cache.keyOf('a'));
        expect(kept).not.toContain(cache.keyOf('b'));
    });

    test('an entry with a request in flight is never evicted', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 1});

        void cache.load('a');
        void cache.load('b');

        // Both are in flight, so neither can be dropped even though the bound is one.
        expect(Object.keys(cache.getData().entries).length).toEqual(2);

        loader.settle[0]('value-a');
        loader.settle[1]('value-b');
        await flush();
    });

    test('an entry a component is reading is never evicted', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

        await fill(cache, loader, ['a']);

        cache.subscribe(() => undefined, {
            id: 'reader',
            reads: readsOf(`entries.${cache.keyOf('a')}.data`),
        });

        void cache.load('b');
        loader.settle[1]('value-b');
        await flush();

        // `a` is over the bound and least recently used, but blanking a rendered entry is worse.
        expect(Object.keys(cache.getData().entries)).toContain(cache.keyOf('a'));
    });

    test('a subscriber without read paths does not pin the cache', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

        await fill(cache, loader, ['a']);

        // Devtools and persistence subscribe to everything; counting them would pin every entry.
        cache.subscribe(() => undefined, {id: 'devtools'});

        void cache.load('b');
        loader.settle[1]('value-b');
        await flush();

        expect(Object.keys(cache.getData().entries)).not.toContain(cache.keyOf('a'));
    });
});
