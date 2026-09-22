import {EResourceStatus} from "@/Carburetor";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

interface IDeferred {
    resolve: (value: string) => void;
    reject: (error: unknown) => void;
    signal: AbortSignal;
}

const makeLoader = () => {
    const calls: string[] = [];
    const pending: IDeferred[] = [];

    const load = (id: string, signal: AbortSignal): Promise<string> => {
        calls.push(id);

        let resolve: (value: string) => void = () => undefined;
        let reject: (error: unknown) => void = () => undefined;

        const promise = new Promise<string>((onResolve, onReject) => {
            resolve = onResolve;
            reject = onReject;
        });

        pending.push({resolve, reject, signal});

        return promise;
    };

    return {calls, pending, load};
};

const flush = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
};

/** Loads an entry and settles it, so the interesting part of each test starts from fresh data. */
const withData = async (cache: ResourceCache<string, string>, loader: ReturnType<typeof makeLoader>) => {
    void cache.load('a');
    loader.pending[0].resolve('first');
    await flush();
};

describe('ResourceCache.refresh', () => {
    test('fetches even when the entry is perfectly fresh', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await withData(cache, loader);

        expect(cache.getEntry('a').stale).toBeFalsy();

        void cache.refresh('a');

        // `load` would have returned the cached answer; a refresh button must not.
        expect(loader.calls).toEqual(['a', 'a']);
    });

    test('a successful refresh replaces the data and the timestamp', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await withData(cache, loader);

        const before = cache.getEntry('a').updatedAt as number;

        await new Promise(resolve => setTimeout(resolve, 2));

        const request = cache.refresh('a');
        loader.pending[1].resolve('second');
        await request;

        const entry = cache.getEntry('a');

        expect(entry.data).toEqual('second');
        expect(entry.updatedAt as number).toBeGreaterThan(before);
        expect(entry.refreshing).toBeFalsy();
    });

    test('a failed refresh keeps the last good answer and reports the failure beside it', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await withData(cache, loader);

        const request = cache.refresh('a');
        loader.pending[1].reject(new Error('gateway timeout'));
        await request;

        const entry = cache.getEntry('a');

        // The interface can show the data it had and the fact that refreshing failed.
        expect(entry.status).toEqual(EResourceStatus.Success);
        expect(entry.data).toEqual('first');
        expect(entry.error).toEqual('gateway timeout');
        expect(entry.refreshing).toBeFalsy();
    });

    test('a failed refresh does not reset the data age, so the entry stays as old as its data', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await withData(cache, loader);

        const before = cache.getEntry('a').updatedAt as number;
        const request = cache.refresh('a');

        loader.pending[1].reject(new Error('nope'));
        await request;

        expect(cache.getEntry('a').updatedAt).toEqual(before);
    });

    test('a failure on an entry that never succeeded has nothing to keep', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        const request = cache.refresh('a');

        loader.pending[0].reject(new Error('cold start'));
        await request;

        const entry = cache.getEntry('a');

        expect(entry.status).toEqual(EResourceStatus.Error);
        expect(entry.data).toBeUndefined();
        expect(entry.error).toEqual('cold start');
    });

    test('a refresh next to a load of the same arguments joins it', () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        void cache.load('a');
        void cache.refresh('a');

        // The network is already being asked the same question.
        expect(loader.calls).toEqual(['a']);
    });

    test('an aborted refresh does not put its failure on the entry', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await withData(cache, loader);

        void cache.refresh('a');
        cache.abort('a');

        loader.pending[1].reject(new Error('abandoned'));
        await flush();

        const entry = cache.getEntry('a');

        expect(entry.status).toEqual(EResourceStatus.Success);
        expect(entry.data).toEqual('first');
        expect(entry.error).toBeUndefined();
        expect(entry.refreshing).toBeFalsy();
    });

    test('refreshing one entry leaves the others alone', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        void cache.load('a');
        void cache.load('b');
        loader.pending[0].resolve('ann');
        loader.pending[1].resolve('bob');
        await flush();

        const request = cache.refresh('a');
        loader.pending[2].resolve('ann again');
        await request;

        expect(cache.getEntry('a').data).toEqual('ann again');
        expect(cache.getEntry('b').data).toEqual('bob');
    });

    test('a failed refresh marks the entry failed until an answer or a new invalidation re-arms it', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await withData(cache, loader);

        const request = cache.refresh('a');
        loader.pending[1].reject(new Error('gateway timeout'));
        await request;

        expect(cache.getEntry('a').failed).toBeTruthy();

        // A new invalidation is an explicit external event, so the entry may be asked again.
        cache.invalidate('a');
        expect(cache.getEntry('a').failed).toBeFalsy();

        void cache.load('a');
        loader.pending[2].resolve('second');
        await flush();

        expect(cache.getEntry('a').data).toEqual('second');
        expect(cache.getEntry('a').failed).toBeFalsy();
    });

    test('an explicit refresh after a failed one retries the loader', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await withData(cache, loader);

        const failed = cache.refresh('a');
        loader.pending[1].reject(new Error('gateway timeout'));
        await failed;

        const retried = cache.refresh('a');

        // A failed refresh does not lock the entry: refresh is the documented way back in.
        expect(loader.calls).toEqual(['a', 'a', 'a']);

        loader.pending[2].resolve('second');
        await retried;

        const entry = cache.getEntry('a');

        expect(entry.data).toEqual('second');
        expect(entry.error).toBeUndefined();
        expect(entry.failed).toBeFalsy();
    });
});
