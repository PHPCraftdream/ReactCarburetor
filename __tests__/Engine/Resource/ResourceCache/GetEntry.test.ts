import {TPath, TPathSet} from "@/Carburetor";
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


const readsOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

describe('ResourceCache.getEntry (R3-10: a documented mutable escape, H23 — pinned, not changed)', () => {
    test('mutating a returned view\'s data field mutates the cache with no version bump or notification', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 60_000});

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        let notified = 0;
        cache.subscribe(() => notified++, {id: 'watcher', reads: readsOf(cache.pathOf('a'))});

        const versionBefore = cache.getVersion();
        const view = cache.getEntry('a');

        // H23: known and documented, not a regression. Pinned here so a future change to
        // getEntry()/the view cache cannot silently make this either safer (a wrapped/frozen
        // `data`) or worse (e.g. sharing the view object itself across distinct keys) without
        // this test forcing that change to be a deliberate, reviewed one.
        (view.data as IUser).name = 'edited';

        expect(cache.getEntry('a').data).toEqual({id: 'a', name: 'edited'});
        expect(cache.getVersion()).toEqual(versionBefore);
        expect(notified).toEqual(0);
    });
});
