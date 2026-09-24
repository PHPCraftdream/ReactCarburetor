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


describe('ResourceCache.keyOf (R6-05: a mutated argument object is keyed by its current values)', () => {
    test('a query object mutated between two loads is loaded and read under the new key', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, {id: string}>((args, signal) => loader.load(args.id, signal));

        const query = {id: 'a'};

        void cache.load(query);
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        // The report's exact scenario: one object, mutated in place between calls.
        query.id = 'b';

        // The mutation diagnostic routes through console.error, and the suite's console guard
        // fails a test that lets output through uncaptured: capture it here; its once-per-cache
        // contract is asserted in its own test below.
        const reports: unknown[][] = [];
        const spy = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
            reports.push(args);
        });

        void cache.load(query);

        spy.mockRestore();

        // The second load is a real loader call: the stale memoized key is not reused.
        expect(loader.calls).toEqual(['a', 'b']);
        expect(reports.length).toEqual(1);

        loader.pending[1].resolve({id: 'b', name: 'Bob'});
        await flush();

        expect(cache.getEntry(query).data).toEqual({id: 'b', name: 'Bob'});
        expect(cache.getEntry(query).status).toEqual(EResourceStatus.Success);
        // The old answer stays untouched under the key its own values still produce.
        expect(cache.getEntry({id: 'a'}).data).toEqual({id: 'a', name: 'Ann'});
    });

    test('the same-reference mutation is reported once per cache, not once per call', () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, {id: string}>((args, signal) => loader.load(args.id, signal));

        const query = {id: 'a'};

        cache.keyOf(query);

        const reports: unknown[][] = [];
        const spy = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
            reports.push(args);
        });

        query.id = 'b';
        expect(cache.keyOf(query)).toEqual(cache.keyOf({id: 'b'}));

        // Unchanged reads between mutations report nothing further...
        expect(cache.keyOf(query)).toEqual(cache.keyOf({id: 'b'}));

        // ...and neither does a second mutation: one report per cache.
        query.id = 'c';
        expect(cache.keyOf(query)).toEqual(cache.keyOf({id: 'c'}));

        spy.mockRestore();

        expect(reports.length).toEqual(1);
        expect(String(reports[0][0])).toContain('mutated');
    });
});
