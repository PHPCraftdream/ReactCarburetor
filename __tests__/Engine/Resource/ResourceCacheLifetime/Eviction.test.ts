import {R} from "@/Carburetor/Store/Diagnostics/Internal/ResourceSymbols";
import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {TestCache} from '../ResourceCache/Helpers/TestCache';
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

describe('ResourceCache eviction', () => {
    test('the cache stays within its bound, dropping the least recently used first', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 2, ttl: 60_000});

        await fill(cache, loader, ['a', 'b']);

        // Touching `a` makes `b` the least recently used.
        cache.getEntry('a');

        void cache.load('c');
        loader.settle[2]('value-c');
        await flush();

        const kept = Object.keys(cache.getData().entries);

        expect(kept.length).toEqual(2);
        expect(kept).toContain(cache.exposeKeyOf('a'));
        expect(kept).toContain(cache.exposeKeyOf('c'));
        expect(kept).not.toContain(cache.exposeKeyOf('b'));
    });

    test('use order is exact even when everything happens in the same millisecond', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 2, ttl: 60_000});

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

        expect(kept).toContain(cache.exposeKeyOf('a'));
        expect(kept).not.toContain(cache.exposeKeyOf('b'));
    });

    test('an entry with a request in flight is never evicted', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 1});

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
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

        await fill(cache, loader, ['a']);

        cache.subscribe(() => undefined, {
            id: 'reader',
            reads: readsOf(`entries.${cache.exposeKeyOf('a')}.data`),
        });

        void cache.load('b');
        loader.settle[1]('value-b');
        await flush();

        // `a` is over the bound and least recently used, but blanking a rendered entry is worse.
        expect(Object.keys(cache.getData().entries)).toContain(cache.exposeKeyOf('a'));
    });

    test('an entry-level subscription pins an entry whatever its key holds', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

        await fill(cache, loader, ['a.b']);

        // Exactly the path useResource subscribes to.
        cache.subscribe(() => undefined, {id: 'entry-reader', reads: readsOf(cache.exposePathOf('a.b'))});

        void cache.load('c');
        loader.settle[1]('value-c');
        await flush();

        // Over the bound and least recently used, but blanking a rendered entry is worse.
        expect(Object.keys(cache.getData().entries)).toContain(cache.exposeKeyOf('a.b'));
    });

    test('a nested tracked read pins its entry whatever its key holds', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

        await fill(cache, loader, ['a~b']);

        // A read tracked one level inside the entry, the way a proxy read records it.
        cache.subscribe(() => undefined, {id: 'leaf-reader', reads: readsOf(`${cache.exposePathOf('a~b')}.data`)});

        void cache.load('c');
        loader.settle[1]('value-c');
        await flush();

        expect(Object.keys(cache.getData().entries)).toContain(cache.exposeKeyOf('a~b'));
    });

    test('a remaining sibling read still pins an entry after re-subscription', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

        await fill(cache, loader, ['a']);

        const entryPath = cache.exposePathOf('a');

        cache.subscribe(() => undefined, {
            id: 'reader', reads: readsOf(`${entryPath}.data`, `${entryPath}.status`),
        });
        cache.subscribe(() => undefined, {id: 'reader', reads: readsOf(`${entryPath}.data`)});

        void cache.load('b');
        loader.settle[1]('value-b');
        await flush();

        expect(Object.keys(cache.getData().entries)).toContain(cache.exposeKeyOf('a'));

        cache.unsubscribe('reader');
        void cache.load('c');
        loader.settle[2]('value-c');
        await flush();

        expect(Object.keys(cache.getData().entries)).not.toContain(cache.exposeKeyOf('a'));
    });

    test('a subscriber without read paths does not pin the cache', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

        await fill(cache, loader, ['a']);

        // Devtools and persistence subscribe to everything; counting them would pin every entry.
        cache.subscribe(() => undefined, {id: 'devtools'});

        void cache.load('b');
        loader.settle[1]('value-b');
        await flush();

        expect(Object.keys(cache.getData().entries)).not.toContain(cache.exposeKeyOf('a'));
    });

    test('entries that settle bring the cache back within its bound', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 1});

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
        expect(Object.keys(cache.getData().entries)).toEqual([cache.exposeKeyOf('c')]);
    });

    test('reads of absent keys do not pile up use-order records', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 2});
        const lastUsed = () =>
            (cache as unknown as {[R.eviction]: {lastUsed: Map<string, number>}})[R.eviction].lastUsed;

        await fill(cache, loader, ['a']);

        for (let index = 0; index < 50; index++) {
            cache.getEntry(`absent-${index}`);
        }

        // Polling many keys that never load must not grow bookkeeping eviction can never reclaim.
        expect(lastUsed().size).toEqual(1);
        expect(lastUsed().has(cache.exposeKeyOf('a'))).toBeTruthy();

        // Eviction still orders by the reads that did happen: `a` was used first, so it goes.
        void cache.load('b');
        loader.settle[1]('value-b');
        void cache.load('c');
        loader.settle[2]('value-c');
        await flush();

        const kept = Object.keys(cache.getData().entries);

        expect(kept.length).toEqual(2);
        expect(kept).toContain(cache.exposeKeyOf('b'));
        expect(kept).toContain(cache.exposeKeyOf('c'));
        expect(kept).not.toContain(cache.exposeKeyOf('a'));
    });

    test('eviction behind a suspend publishes with the deferred emit, not mid-render', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 1, ttl: 60_000});

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
        expect(Object.keys(cache.getData().entries)).toEqual([cache.exposeKeyOf('b')]);
    });

    test('eviction drops the evicted entry\'s cached view', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 2, ttl: 60_000});
        const viewCache = () => (cache as unknown as {[R.viewCache]: Map<string, unknown>})[R.viewCache];

        await fill(cache, loader, ['a', 'b']);
        cache.getEntry('a');
        cache.getEntry('b');

        // Touching `a` makes `b` the least recently used.
        cache.getEntry('a');

        void cache.load('c');
        loader.settle[2]('value-c');
        await flush();

        expect(Object.keys(cache.getData().entries)).not.toContain(cache.exposeKeyOf('b'));
        expect(viewCache().has(cache.exposeKeyOf('b'))).toBeFalsy();
        expect(viewCache().has(cache.exposeKeyOf('a'))).toBeTruthy();
        // `c` was never read through getEntry, so it holds no view record.
        expect(viewCache().size).toEqual(1);
    });

    test('eviction checks retention through the index, without walking a subscriber\'s read set', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 3, ttl: 60_000});

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
            (cache as unknown as {[S.subscribers]: Record<string, {reads: Set<TPath>}>})[S.subscribers];
        const counters: CountingReads[] = [];

        // Three pinned entries, three readers. The counting set replaces each subscriber's own
        // read set after subscribe() has already filed it into subscriberIndex, so what this
        // isolates is exactly what eviction consults: the index, never a subscriber's own set.
        ['a', 'b', 'c'].forEach((key: string) => {
            const id = cache.subscribe(() => undefined, {id: `reader-${key}`, reads: readsOf(cache.exposePathOf(key))});
            const counted = new CountingReads(subscribers()[id].reads);

            subscribers()[id].reads = counted;
            counters.push(counted);
        });

        const materializations = (): number =>
            counters.reduce((sum: number, reads: CountingReads) => sum + reads.enumerations, 0);

        void cache.load('d');

        // subscriberIndex answers "is anyone reading this key" per candidate in O(1); no
        // subscriber's read set is ever walked.
        expect(materializations()).toEqual(0);

        loader.settle[3]('value-d');
        await flush();

        // Retention itself still holds at the second pass: the three read entries stay, the
        // unread fourth one goes — and still without walking any subscriber's read set.
        expect(materializations()).toEqual(0);
        expect(Object.keys(cache.getData().entries)).toEqual([
            cache.exposeKeyOf('a'),
            cache.exposeKeyOf('b'),
            cache.exposeKeyOf('c'),
        ]);
    });
});
