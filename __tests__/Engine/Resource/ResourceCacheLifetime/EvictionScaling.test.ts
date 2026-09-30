import {TPath} from "@/Carburetor/Models/Paths";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

const flush = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
};

describe('ResourceCache eviction scaling (R16-04)', () => {
    test('4000 retained rows settle with a walk count proportional to N, not N^2', async () => {
        const N = 4000;
        const cache = new ResourceCache<string, string>((id: string) => Promise.resolve(`value-${id}`));
        const walks = (): number => (cache as unknown as {eviction: {walks: number}}).eviction.walks;

        for (let index = 0; index < N; index++) {
            const key = String(index);

            // Mirrors useResource: a subscriber reads exactly this row's own entry, so every
            // row stays retained for as long as it is mounted — the shape that made every
            // fetch and every answer scan the whole live set before this fix.
            cache.subscribe(() => undefined, {id: key, reads: new Set<TPath>([cache.pathOf(key)])});
            void cache.load(key);
        }

        await flush();

        // Nothing was evictable: every entry has a reader.
        expect(Object.keys(cache.getData().entries).length).toEqual(N);

        // Before the fix, evict() filtered and sorted the whole live entry set on every fetch
        // and every answer — ~2N walks of up to N keys, the O(N^2) measured at 8073 ms to
        // settle 4000 rows (docs/js-review-round-16-2026-09-28.md, R16-04). A bounded number
        // of scans (doubling the growth trigger each time one finds nothing to evict) keeps
        // the total a small multiple of N instead of growing with N^2.
        expect(walks()).toBeLessThan(N * 3);
    });

    test('a cache with maxEntries: Infinity never walks at all', async () => {
        const N = 500;
        const cache = new ResourceCache<string, string>((id: string) => Promise.resolve(`value-${id}`), {
            maxEntries: Infinity,
        });
        const walks = (): number => (cache as unknown as {eviction: {walks: number}}).eviction.walks;

        for (let index = 0; index < N; index++) {
            void cache.load(String(index));
        }

        await flush();

        // entryCount <= maxEntries short-circuits before anything is walked or even counted
        // with Object.keys — the O(1) case the review's evidence table measured at 2157 ms of
        // self time in Object.keys alone, for a run that never evicted a single entry.
        expect(walks()).toEqual(0);
    });

    test('a reader leaving lets the next fetch reclaim what growth alone would not', async () => {
        const cache = new ResourceCache<string, string>((id: string) => Promise.resolve(`value-${id}`), {
            maxEntries: 2,
        });
        const subscribeTo = (key: string): void => {
            cache.subscribe(() => undefined, {id: key, reads: new Set<TPath>([cache.pathOf(key)])});
        };
        const walks = (): number => (cache as unknown as {eviction: {walks: number}}).eviction.walks;

        subscribeTo('a');
        subscribeTo('b');
        void cache.load('a');
        void cache.load('b');
        await flush();

        expect(Object.keys(cache.getData().entries).length).toEqual(2);

        // A third retained row pushes the cache past its bound, but every entry — including
        // this one — has a reader: the scan finds nothing to evict and remembers it.
        subscribeTo('c');
        void cache.load('c');
        await flush();

        expect(Object.keys(cache.getData().entries).length).toEqual(3);

        const walksBeforeDeparture = walks();

        // `a`'s reader leaves. The entry count has not grown since the scan above, so
        // growth-based hysteresis alone would not look again — the departure itself has to
        // trigger the next look.
        cache.unsubscribe('a');

        subscribeTo('d');
        void cache.load('d');
        await flush();

        // A real scan ran this time, not a skipped one.
        expect(walks()).toBeGreaterThan(walksBeforeDeparture);

        const kept = Object.keys(cache.getData().entries);

        // `a`, now unread and the least recently used unretained entry, is the one reclaimed.
        expect(kept).not.toContain(cache.keyOf('a'));
        expect(kept).toContain(cache.keyOf('b'));
        expect(kept).toContain(cache.keyOf('c'));
        expect(kept).toContain(cache.keyOf('d'));
    });
});
