import {R} from "@/Carburetor/Store/Diagnostics/Internal/ResourceSymbols";
import {TestCache} from '../ResourceCache/Helpers/TestCache';
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceEntry} from "@/Carburetor/Models/Resource";

const ready = (value: string): IResourceEntry<string> => ({
    status: EResourceStatus.Success, data: value, error: undefined, updatedAt: Date.now(),
    refreshing: false, invalidated: false, failed: false,
});

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
    test('setData reconciles additions, removals, identity and LRU before later eviction', async () => {
        const cache = new TestCache<string, string>((id) => Promise.resolve(id), {
            maxEntries: 2, ttl: Infinity,
        });
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((key) => cache.exposeKeyOf(key));
        const ledger = (cache as unknown as {[R.eviction]: {count: number; lastUsed: Map<string, number>}})[R.eviction];
        const first = {entries: {[a]: ready('a'), [b]: ready('b')}};

        expect(cache.setData(first)).toBe(first);
        expect(cache.getData()).toBe(first);
        expect(ledger.count).toBe(2);
        expect([...ledger.lastUsed.keys()]).toEqual([a, b]);

        cache.getEntry('a');
        const second = {entries: {[a]: ready('a2'), [b]: ready('b2'), [c]: ready('c')}};

        cache.setData(second);
        expect([...ledger.lastUsed.keys()]).toEqual([b, a, c]);
        expect(ledger.count).toBe(3);

        const third = {entries: {[a]: ready('a3'), [b]: ready('b3')}};

        cache.setData(third);
        expect(ledger.count).toBe(2);
        expect([...ledger.lastUsed.keys()]).toEqual([b, a]);

        await cache.load('d');
        expect(Object.keys(cache.getData().entries)).toEqual([a, d]);
        expect(ledger.count).toBe(2);
    });

    test('setData in a synchronous subscriber is reconciled before a reentrant load', async () => {
        const cache = new TestCache<string, string>((id) => Promise.resolve(id), {
            maxEntries: 1, ttl: Infinity,
        });
        const [a, b, c] = ['a', 'b', 'c'].map((key) => cache.exposeKeyOf(key));
        let started = false;
        const id = cache.subscribe(() => {
            if (!started) {
                started = true;
                cache.unsubscribe(id);
                void cache.load('c');
            }
        });

        cache.setData({entries: {[a]: ready('a'), [b]: ready('b')}});
        await flush();

        const ledger = (cache as unknown as {[R.eviction]: {count: number}})[R.eviction];

        expect(cache.getData().entries[c]?.data).toBe('c');
        expect(ledger.count).toBe(Object.keys(cache.getData().entries).length);
        expect(Object.keys(cache.getData().entries)).toEqual([c]);
    });

    test('setData releases an exhausted eviction scan after changing the entry set', async () => {
        const cache = new TestCache<string, string>((id) => Promise.resolve(id), {
            maxEntries: 1, ttl: Infinity,
        });
        const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((key) => cache.exposeKeyOf(key));
        const readers = [a, b].map((key) => cache.subscribe(() => undefined, {
            reads: new Set([cache.exposePathOfKey(key)]),
        }));

        await Promise.all([cache.load('a'), cache.load('b')]);
        expect(Object.keys(cache.getData().entries)).toEqual([a, b]);

        cache.setData({entries: {[c]: ready('c'), [d]: ready('d')}});
        void cache.load('e');

        expect(Object.keys(cache.getData().entries)).toEqual([e]);
        readers.forEach((id) => cache.unsubscribe(id));
    });

    test('an in-flight answer settles into a replaced entry set without losing count', async () => {
        let resolve: (value: string) => void = () => undefined;
        const cache = new TestCache<string, string>(() => new Promise((done) => { resolve = done; }), {
            maxEntries: 3,
        });
        const pending = cache.load('a');
        const [a, b] = ['a', 'b'].map((key) => cache.exposeKeyOf(key));
        const replacement = {entries: {[a]: ready('provisional'), [b]: ready('b')}};

        cache.setData(replacement);
        expect(cache.getData()).toBe(replacement);
        expect((cache as unknown as {[R.eviction]: {count: number}})[R.eviction].count).toBe(2);

        resolve('answer');
        await pending;

        expect(cache.getEntry('a').data).toBe('answer');
        expect(cache.getEntry('b').data).toBe('b');
        expect((cache as unknown as {[R.eviction]: {count: number}})[R.eviction].count).toBe(2);
    });

    test('entryCount matches the live entry set after a random sequence of operations', async () => {
        const rng = makeRng(20260928);
        const cache = new TestCache<string, string>((id: string) => Promise.resolve(`value-${id}`), {
            maxEntries: 5,
        });
        const entryCount = (): number => (cache as unknown as {[R.eviction]: {count: number}})[R.eviction].count;
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
        const seed = new TestCache<string, string>((id: string) => Promise.resolve(`value-${id}`), {
            ttl: 60_000,
        });

        for (const key of ['a', 'b', 'c']) {
            void seed.load(key);
        }

        await flush();

        const snapshot = seed.snapshot();
        const cache = new TestCache<string, string>((id: string) => Promise.resolve(`value-${id}`), {
            maxEntries: 3,
            ttl: 60_000,
        });
        const entryCount = (): number => (cache as unknown as {[R.eviction]: {count: number}})[R.eviction].count;
        const lastUsed = (): Map<string, number> =>
            (cache as unknown as {[R.eviction]: {lastUsed: Map<string, number>}})[R.eviction].lastUsed;

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

        expect(kept).not.toContain(cache.exposeKeyOf('a'));
        expect(kept).toContain(cache.exposeKeyOf('b'));
        expect(kept).toContain(cache.exposeKeyOf('c'));
        expect(kept).toContain(cache.exposeKeyOf('d'));
        expect(entryCount()).toEqual(Object.keys(cache.getData().entries).length);
    });
});
