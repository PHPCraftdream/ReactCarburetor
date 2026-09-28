import {EResourceStatus} from "@/Carburetor";
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

describe('ResourceCache forget', () => {
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

    test('forget keeps entryCount in step with the entries it actually removes', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);
        const entryCount = () => (cache as unknown as {eviction: {count: number}}).eviction.count;

        await fill(cache, loader, ['a', 'b', 'c']);
        expect(entryCount()).toEqual(3);

        cache.forget('a');
        expect(entryCount()).toEqual(2);

        cache.forgetAll();
        expect(entryCount()).toEqual(0);
    });
});
