import {CarburetorHistory, EResourceStatus, TPath, TPathSet} from "@/Carburetor";
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

    test('an entry-level subscription pins an entry whatever its key holds', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

        await fill(cache, loader, ['a.b']);

        // Exactly the path useResource subscribes to.
        cache.subscribe(() => undefined, {id: 'entry-reader', reads: readsOf(cache.pathOf('a.b'))});

        void cache.load('c');
        loader.settle[1]('value-c');
        await flush();

        // Over the bound and least recently used, but blanking a rendered entry is worse.
        expect(Object.keys(cache.getData().entries)).toContain(cache.keyOf('a.b'));
    });

    test('a nested tracked read pins its entry whatever its key holds', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

        await fill(cache, loader, ['a~b']);

        // A read tracked one level inside the entry, the way a proxy read records it.
        cache.subscribe(() => undefined, {id: 'leaf-reader', reads: readsOf(`${cache.pathOf('a~b')}.data`)});

        void cache.load('c');
        loader.settle[1]('value-c');
        await flush();

        expect(Object.keys(cache.getData().entries)).toContain(cache.keyOf('a~b'));
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

    test('entries that settle bring the cache back within its bound', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 1});

        void cache.load('a');
        void cache.load('b');
        void cache.load('c');

        // All three had a request in flight when they started, so none could be dropped then.
        expect(Object.keys(cache.getData().entries).length).toEqual(3);

        loader.settle[0]('value-a');
        loader.settle[1]('value-b');
        loader.settle[2]('value-c');
        await flush();

        // Without a check at settlement the cache would sit over its bound forever.
        expect(Object.keys(cache.getData().entries)).toEqual([cache.keyOf('c')]);
    });

    test('reads of absent keys do not pile up use-order records', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 2});
        const lastUsed = () => (cache as unknown as {lastUsed: Map<string, number>}).lastUsed;

        await fill(cache, loader, ['a']);

        for (let index = 0; index < 50; index++) {
            cache.getEntry(`absent-${index}`);
        }

        // Polling many keys that never load must not grow bookkeeping eviction can never reclaim.
        expect(lastUsed().size).toEqual(1);
        expect(lastUsed().has(cache.keyOf('a'))).toBeTruthy();

        // Eviction still orders by the reads that did happen: `a` was used first, so it goes.
        void cache.load('b');
        loader.settle[1]('value-b');
        void cache.load('c');
        loader.settle[2]('value-c');
        await flush();

        const kept = Object.keys(cache.getData().entries);

        expect(kept.length).toEqual(2);
        expect(kept).toContain(cache.keyOf('b'));
        expect(kept).toContain(cache.keyOf('c'));
        expect(kept).not.toContain(cache.keyOf('a'));
    });

    test('eviction behind a suspend publishes with the deferred emit, not mid-render', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

        await fill(cache, loader, ['a']);

        // A store-wide watcher, the way devtools hang off the cache: it hears about every write,
        // so nothing published synchronously can slip past it.
        let notified = 0;
        cache.subscribe(() => notified++, {id: 'observer'});

        // What a render does with a full cache: ask for a new key through suspend().
        let thrown: unknown;

        try {
            cache.suspend('b');
        } catch (error: unknown) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Promise);

        // Neither the pending-status write nor the eviction was published during the call.
        expect(notified).toEqual(0);

        await flush();

        // Both went out together on the deferred microtask, and the bound was reclaimed.
        expect(notified).toEqual(1);
        expect(Object.keys(cache.getData().entries)).toEqual([cache.keyOf('b')]);
    });

    test('forget drops the cached view along with the rest of the entry', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});
        const viewCache = () => (cache as unknown as {viewCache: Map<string, unknown>}).viewCache;

        await fill(cache, loader, ['a', 'b']);
        cache.getEntry('a');
        cache.getEntry('b');

        expect(viewCache().size).toEqual(2);

        cache.forget('a');

        expect(viewCache().has(cache.keyOf('a'))).toBeFalsy();
        expect(viewCache().has(cache.keyOf('b'))).toBeTruthy();
    });

    test('eviction drops the evicted entry\'s cached view', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 2, ttl: 60_000});
        const viewCache = () => (cache as unknown as {viewCache: Map<string, unknown>}).viewCache;

        await fill(cache, loader, ['a', 'b']);
        cache.getEntry('a');
        cache.getEntry('b');

        // Touching `a` makes `b` the least recently used.
        cache.getEntry('a');

        void cache.load('c');
        loader.settle[2]('value-c');
        await flush();

        expect(Object.keys(cache.getData().entries)).not.toContain(cache.keyOf('b'));
        expect(viewCache().has(cache.keyOf('b'))).toBeFalsy();
        expect(viewCache().has(cache.keyOf('a'))).toBeTruthy();
        // `c` was never read through getEntry, so it holds no view record.
        expect(viewCache().size).toEqual(1);
    });

    test('forgetAll empties the cached views', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});
        const viewCache = () => (cache as unknown as {viewCache: Map<string, unknown>}).viewCache;

        await fill(cache, loader, ['a', 'b']);
        cache.getEntry('a');
        cache.getEntry('b');

        cache.forgetAll();

        expect(viewCache().size).toEqual(0);
    });

    test('CarburetorHistory undo discards a late in-flight answer from before the undo (R3-03)', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});
        const history = new CarburetorHistory(cache);

        void cache.load('a');
        loader.settle[0]('Ann');
        await flush();

        void cache.refresh('a');
        expect(cache.getEntry('a').refreshing).toBeTruthy();

        history.undo();

        expect(cache.getEntry('a').data).toEqual('Ann');
        expect(cache.getEntry('a').refreshing).toBeFalsy();

        // The refresh that was in flight when undo() ran belongs to a generation the undo
        // replaced.
        loader.settle[1]('late');
        await flush();

        expect(cache.getEntry('a').data).toEqual('Ann');
    });

    test('one eviction pass materializes each subscriber once, not once per candidate (R5-06)', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {maxEntries: 3, ttl: 60_000});

        await fill(cache, loader, ['a', 'b', 'c']);

        /** Counts how often the cache walked one subscriber's read paths. */
        class CountingReads extends Set<TPath> {
            public enumerations: number = 0;

            public forEach(callback: (value: TPath, value2: TPath, set: Set<TPath>) => void, thisArg?: unknown): void {
                this.enumerations += 1;
                super.forEach(callback, thisArg);
            }

            public [Symbol.iterator](): IterableIterator<TPath> {
                this.enumerations += 1;

                return super[Symbol.iterator]();
            }
        }

        const subscribers = (): Record<string, {reads: Set<TPath>}> =>
            (cache as unknown as {subscribers: Record<string, {reads: Set<TPath>}>}).subscribers;
        const counters: CountingReads[] = [];

        // Three pinned entries, three readers — the report's bounded scenario. subscribe()
        // copies the set, so the counting set replaces the copy the store actually keeps.
        ['a', 'b', 'c'].forEach((key: string) => {
            const id = cache.subscribe(() => undefined, {id: `reader-${key}`, reads: readsOf(cache.pathOf(key))});
            const counted = new CountingReads(subscribers()[id].reads);

            subscribers()[id].reads = counted;
            counters.push(counted);
        });

        const materializations = (): number =>
            counters.reduce((sum: number, reads: CountingReads) => sum + reads.enumerations, 0);

        void cache.load('d');

        // One pass: the pending key is skipped, and each reader's set was walked once to build
        // the retained set. The old per-candidate check walked the same three sets nine times.
        expect(materializations()).toEqual(3);

        loader.settle[3]('value-d');
        await flush();

        // The second pass, at settlement, walked each reader once more — and retention itself
        // survived the batching: the three read entries stay, the unread fourth one goes.
        expect(materializations()).toEqual(6);
        expect(Object.keys(cache.getData().entries)).toEqual([
            cache.keyOf('a'),
            cache.keyOf('b'),
            cache.keyOf('c'),
        ]);
    });
});
