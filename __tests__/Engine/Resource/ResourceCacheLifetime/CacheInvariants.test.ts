import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

const flush = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
};

/**
 * A small, seeded PRNG (mulberry32) so the fuzz test below is deterministic: a flaky failure
 * must be reproducible from the seed alone, not chased across re-runs.
 */
const makeRng = (seed: number): (() => number) => {
    let state = seed >>> 0;

    return (): number => {
        state = (state + 0x6D2B79F5) >>> 0;

        let t = state;

        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

describe('ResourceCache bookkeeping invariants (R16-04)', () => {
    test('entryCount matches the live entry set after a random sequence of operations', async () => {
        const rng = makeRng(20260928);
        const cache = new ResourceCache<string, string>((id: string) => Promise.resolve(`value-${id}`), {
            maxEntries: 5,
        });
        const entryCount = (): number => (cache as unknown as {eviction: {count: number}}).eviction.count;
        const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

        for (let step = 0; step < 300; step++) {
            const key = keys[Math.floor(rng() * keys.length)];

            switch (Math.floor(rng() * 5)) {
                case 0:
                    void cache.load(key);
                    break;
                case 1:
                    void cache.refresh(key);
                    break;
                case 2:
                    cache.forget(key);
                    break;
                case 3:
                    cache.getEntry(key);
                    break;
                default:
                    cache.invalidate(key);
            }

            // Settling is asynchronous; draining every few steps lets settleSuccess (and the
            // eviction it can trigger) land before the next check, without serializing every
            // single step behind a microtask turn.
            if (step % 7 === 0) {
                await flush();
            }

            expect(entryCount()).toEqual(Object.keys(cache.getData().entries).length);
        }

        await flush();
        expect(entryCount()).toEqual(Object.keys(cache.getData().entries).length);
    }, 20000);

    test('restore/hydration keeps entryCount and LRU order consistent', async () => {
        const seed = new ResourceCache<string, string>((id: string) => Promise.resolve(`value-${id}`), {
            ttl: 60_000,
        });

        for (const key of ['a', 'b', 'c']) {
            void seed.load(key);
        }

        await flush();

        const snapshot = seed.snapshot();
        const cache = new ResourceCache<string, string>((id: string) => Promise.resolve(`value-${id}`), {
            maxEntries: 3,
            ttl: 60_000,
        });
        const entryCount = (): number => (cache as unknown as {eviction: {count: number}}).eviction.count;
        const lastUsed = (): Map<string, number> =>
            (cache as unknown as {eviction: {lastUsed: Map<string, number>}}).eviction.lastUsed;

        cache.restore(snapshot);

        // restore() rebuilds the live entry set wholesale: its own bookkeeping (entryCount,
        // lastUsed) has to come out in step with it, not with the new instance's maxEntries.
        expect(entryCount()).toEqual(3);
        expect(entryCount()).toEqual(Object.keys(cache.getData().entries).length);
        expect(lastUsed().size).toEqual(3);

        // A fetch past the bound evicts using the LRU order restore() established from the
        // snapshot's own key order: the earliest restored key goes first.
        void cache.load('d');
        await flush();

        const kept = Object.keys(cache.getData().entries);

        expect(kept).not.toContain(cache.keyOf('a'));
        expect(kept).toContain(cache.keyOf('b'));
        expect(kept).toContain(cache.keyOf('c'));
        expect(kept).toContain(cache.keyOf('d'));
        expect(entryCount()).toEqual(Object.keys(cache.getData().entries).length);
    });
});
