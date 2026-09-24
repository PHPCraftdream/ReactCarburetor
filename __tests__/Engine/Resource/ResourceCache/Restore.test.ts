import {EResourceStatus} from "@/Carburetor";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

interface IUser {
    id: string;
    name: string;
}

interface IDeferred {
    resolve: (user: IUser) => void;
    reject: (error: unknown) => void;
    promise: Promise<IUser>;
    signal: AbortSignal;
}

/**
 * A loader whose requests are settled by the test, so in-flight states are observable instead of
 * raced. Every call is recorded, which is how deduplication is checked.
 */
const makeLoader = () => {
    const calls: string[] = [];
    const pending: IDeferred[] = [];

    const load = (id: string, signal: AbortSignal): Promise<IUser> => {
        calls.push(id);

        let resolve: (user: IUser) => void = () => undefined;
        let reject: (error: unknown) => void = () => undefined;

        const promise = new Promise<IUser>((onResolve, onReject) => {
            resolve = onResolve;
            reject = onReject;
        });

        pending.push({resolve, reject, promise, signal});

        return promise;
    };

    return {calls, pending, load};
};

const flush = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
};


describe('ResourceCache.restore (R3-03: a late request cannot overwrite a restored snapshot)', () => {
    test('restore during a refresh discards a late success and keeps the restored data', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 60_000});

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'initial'});
        await flush();

        const snapshot = cache.snapshot();

        void cache.refresh('a');
        expect(cache.getEntry('a').refreshing).toBeTruthy();

        cache.restore(snapshot);

        expect(cache.getEntry('a').data).toEqual({id: 'a', name: 'initial'});
        expect(cache.getEntry('a').refreshing).toBeFalsy();

        // The refresh that was in flight when restore() ran belongs to a generation the
        // restore replaced; its answer must land nowhere.
        loader.pending[1].resolve({id: 'a', name: 'late'});
        await flush();

        expect(cache.getEntry('a').data).toEqual({id: 'a', name: 'initial'});
    });

    test('restore during a refresh discards a late failure too', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 60_000});

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'initial'});
        await flush();

        const snapshot = cache.snapshot();

        void cache.refresh('a');
        cache.restore(snapshot);

        loader.pending[1].reject(new Error('late failure'));
        await flush();

        expect(cache.getEntry('a').data).toEqual({id: 'a', name: 'initial'});
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Success);
        expect(cache.getEntry('a').failed).toBeFalsy();
        expect(cache.getFailure('a')).toBeUndefined();
    });

    test('restore over a pending initial load discards a late success and leaves the entry idle', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);

        void cache.load('a');
        const snapshot = cache.snapshot();

        cache.restore(snapshot);

        // The request behind the original load() belongs to a generation this restore
        // replaced, even though the key it targets is the same one in the new snapshot.
        loader.pending[0].resolve({id: 'a', name: 'late'});
        await flush();

        expect(cache.getEntry('a').data).toBeUndefined();
        // R3-04: a Pending snapshot with no request behind it must not claim one forever.
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);

        // The entry is genuinely idle, not merely reporting so: asking again actually fetches.
        void cache.load('a');
        expect(loader.calls).toEqual(['a', 'a']);
    });

    test('restore over a pending initial load discards a late failure', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);

        void cache.load('a');
        const snapshot = cache.snapshot();

        cache.restore(snapshot);

        loader.pending[0].reject(new Error('late'));
        await flush();

        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getFailure('a')).toBeUndefined();
    });

    test('restore cancels a request for a key the new snapshot never mentions', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        const snapshot = cache.snapshot();

        void cache.load('b');
        const signalForB = loader.pending[1].signal;

        cache.restore(snapshot);

        expect(signalForB.aborted).toBeTruthy();
        expect(Object.keys(cache.getData().entries)).toEqual([cache.keyOf('a')]);

        loader.pending[1].resolve({id: 'b', name: 'late-b'});
        await flush();

        // 'b' is gone from the restored state, and the late answer must not resurrect it.
        expect(Object.keys(cache.getData().entries)).toEqual([cache.keyOf('a')]);
        expect(cache.getEntry('b').stale).toBeTruthy();
        expect(cache.getEntry('b').data).toBeUndefined();
    });

    test('restore cancels in-flight requests across several independent keys at once', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 60_000});

        void cache.load('a');
        void cache.load('c');
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        loader.pending[1].resolve({id: 'c', name: 'Carl'});
        await flush();

        const snapshot = cache.snapshot();

        void cache.refresh('a');
        void cache.refresh('c');

        cache.restore(snapshot);

        loader.pending[2].resolve({id: 'a', name: 'late-a'});
        loader.pending[3].resolve({id: 'c', name: 'late-c'});
        await flush();

        expect(cache.getEntry('a').data).toEqual({id: 'a', name: 'Ann'});
        expect(cache.getEntry('c').data).toEqual({id: 'c', name: 'Carl'});
        expect(cache.getEntry('a').refreshing).toBeFalsy();
        expect(cache.getEntry('c').refreshing).toBeFalsy();
    });

    test('fromJSON normalizes a refreshing+invalidated entry hydrated into a fresh cache (R3-04)', async () => {
        const sourceLoader = makeLoader();
        const source = new ResourceCache<IUser, string>(sourceLoader.load, {ttl: 60_000});

        void source.load('a');
        sourceLoader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        source.invalidate('a');
        void source.refresh('a');

        expect(source.getEntry('a').refreshing).toBeTruthy();
        expect(source.getEntry('a').invalidated).toBeTruthy();

        const raw = JSON.stringify(source.toJSON());

        const freshLoader = makeLoader();
        const fresh = new ResourceCache<IUser, string>(freshLoader.load, {ttl: 60_000});

        fresh.fromJSON(JSON.parse(raw));

        const entry = fresh.getEntry('a');

        // Hydration started zero real requests: `refreshing` must not claim one exists.
        expect(entry.refreshing).toBeFalsy();
        // The entry still needs a refresh — that meaning survives the hydration.
        expect(entry.invalidated).toBeTruthy();
        expect(entry.data).toEqual({id: 'a', name: 'Ann'});
        expect(entry.stale).toBeTruthy();

        // Genuinely stale, so a subsequent explicit fetch actually runs.
        void fresh.refresh('a');
        expect(freshLoader.calls).toEqual(['a']);

        freshLoader.pending[0].resolve({id: 'a', name: 'Anna'});
        await flush();

        expect(fresh.getEntry('a').data).toEqual({id: 'a', name: 'Anna'});
        expect(fresh.getEntry('a').invalidated).toBeFalsy();
    });
});
