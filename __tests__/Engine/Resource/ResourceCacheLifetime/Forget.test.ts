import {R} from "@/Carburetor/Store/Diagnostics/Internal/ResourceSymbols";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";
import {persist} from "@/Carburetor/Tooling/persist";
import {TestCache} from '../ResourceCache/Helpers/TestCache';
import {transaction} from "@/Carburetor/Store/Transaction/transaction";

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

describe('ResourceCache forget', () => {
    test('forget drops an entry and its failure', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load);

        await fill(cache, loader, ['a', 'b']);

        cache.forget('a');

        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getEntry('a').data).toBeUndefined();
        expect(cache.getFailure('a')).toBeUndefined();
        expect(cache.getEntry('b').data).toEqual('value-b');
    });

    test('forget cancels the request, so a late answer cannot resurrect the entry', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load);

        void cache.load('a');
        cache.forget('a');

        loader.settle[0]('too late');
        await flush();

        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getEntry('a').data).toBeUndefined();
    });

    test('forgetAll empties the cache', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load);

        await fill(cache, loader, ['a', 'b', 'c']);

        cache.forgetAll();

        expect(Object.keys(cache.getData().entries)).toEqual([]);
    });

    test('forget drops the cached view along with the rest of the entry', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {ttl: 60_000});
        const viewCache = () => (cache as unknown as {[R.viewCache]: Map<string, unknown>})[R.viewCache];

        await fill(cache, loader, ['a', 'b']);
        cache.getEntry('a');
        cache.getEntry('b');

        expect(viewCache().size).toEqual(2);

        cache.forget('a');

        expect(viewCache().has(cache.exposeKeyOf('a'))).toBeFalsy();
        expect(viewCache().has(cache.exposeKeyOf('b'))).toBeTruthy();
    });

    test('forgetAll empties the cached views', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {ttl: 60_000});
        const viewCache = () => (cache as unknown as {[R.viewCache]: Map<string, unknown>})[R.viewCache];

        await fill(cache, loader, ['a', 'b']);
        cache.getEntry('a');
        cache.getEntry('b');

        cache.forgetAll();

        expect(viewCache().size).toEqual(0);
    });

    test('forget keeps entryCount in step with the entries it actually removes', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load);
        const entryCount = () => (cache as unknown as {[R.eviction]: {count: number}})[R.eviction].count;

        await fill(cache, loader, ['a', 'b', 'c']);
        expect(entryCount()).toEqual(3);

        cache.forget('a');
        expect(entryCount()).toEqual(2);

        cache.forgetAll();
        expect(entryCount()).toEqual(0);
    });

    test('empty forgetAll is a true no-op', () => {
        const cache = new TestCache<string, string>(() => Promise.resolve('unused'));
        let callbacks = 0;

        const id = cache.subscribe(() => { callbacks++; });
        cache.forgetAll();

        expect(cache.getVersion()).toEqual(0);
        expect(callbacks).toEqual(0);
        cache.unsubscribe(id);
    });

    test('many ready entries publish once with precise per-key paths and patch hooks', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load, {maxEntries: 200});
        const keys = Array.from({length: 100}, (_, index) => `key-${index}`);

        await fill(cache, loader, keys);

        let wildcard = 0;
        let first = 0;
        let last = 0;
        let missing = 0;
        let patches = 0;

        const ids = [
            cache.subscribe(() => { wildcard++; }),
            cache.subscribe(() => { first++; }, {reads: new Set([cache.exposePathOf(keys[0])])}),
            cache.subscribe(() => { last++; }, {reads: new Set([cache.exposePathOf(keys[99])])}),
            cache.subscribe(() => { missing++; }, {reads: new Set([cache.exposePathOf('missing')])}),
        ];
        const detach = cache.attachPatchListener({patch: () => { patches++; }});
        const baseline = cache.getVersion();

        cache.forgetAll();

        expect(cache.getVersion() - baseline).toEqual(1);
        expect(Object.keys(cache.getData().entries)).toEqual([]);
        expect([wildcard, first, last, missing]).toEqual([1, 1, 1, 0]);
        expect(patches).toBeGreaterThanOrEqual(keys.length);
        detach();
        ids.forEach((id) => cache.unsubscribe(id));
    });

    test.each([false, true])('forgetAll persists once with coalesce=%s', async (coalesce) => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load);

        await fill(cache, loader, ['a', 'b', 'c']);

        const values: string[] = [];
        const storage = {
            getItem: (_key: string): string | null => null,
            setItem: (_key: string, value: string): void => { values.push(value); },
            removeItem: (_key: string): void => undefined,
        };
        const dispose = persist(cache, {key: 'entries', storage, coalesce});

        cache.forgetAll();

        if (coalesce) {
            expect(values).toHaveLength(0);
            await Promise.resolve();
        }

        expect(values).toHaveLength(1);
        expect(JSON.parse(values[0])).toEqual({entries: {}});
        dispose();
    });

    test('nested forgetAll and an outer transaction deliver one final state', async () => {
        const loader = makeLoader();
        const cache = new TestCache<string, string>(loader.load);

        await fill(cache, loader, ['a', 'b']);

        const seen: number[] = [];
        const id = cache.subscribe(() => { seen.push(Object.keys(cache.getData().entries).length); });
        const baseline = cache.getVersion();

        transaction(() => {
            cache.forgetAll();
            cache.forgetAll();
            expect(seen).toEqual([]);
            expect(cache.getVersion() - baseline).toEqual(1);
        });

        expect(seen).toEqual([0]);
        cache.unsubscribe(id);
    });

    test('exception after a partial clear publishes the partial state and releases the scope', async () => {
        class ThrowingCache extends ResourceCache<string, string> {
            public fail = true;

            public [R.forgetKey](key: string): void {
                if (this.fail && key === this[R.keyOf]('b')) {
                    throw new Error('stop');
                }

                super[R.forgetKey](key);
            }
        }

        const loader = makeLoader();
        const cache = new ThrowingCache(loader.load);

        await fill(cache, loader, ['a', 'b']);

        let callbacks = 0;
        const id = cache.subscribe(() => { callbacks++; });
        const baseline = cache.getVersion();

        expect(() => cache.forgetAll()).toThrow('stop');
        expect(cache.getVersion() - baseline).toEqual(1);
        expect(callbacks).toEqual(1);
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getEntry('b').data).toEqual('value-b');

        cache.fail = false;
        cache.forgetAll();

        expect(cache.getVersion() - baseline).toEqual(2);
        expect(callbacks).toEqual(2);
        expect(Object.keys(cache.getData().entries)).toEqual([]);
        cache.unsubscribe(id);
    });
});
