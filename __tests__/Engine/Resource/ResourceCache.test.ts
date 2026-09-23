import {EResourceStatus, TPath, TPathSet} from "@/Carburetor";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";
import {encodeCacheKey} from "@/Carburetor/Resource/Cache/encodeCacheKey";

// Hoisted above the imports, like `vi.mock`: `{spy: true}` keeps the real encoder running and
// only wraps the export in a call-tracking spy, so every test below behaves as before.
rstest.mock("@/Carburetor/Resource/Cache/encodeCacheKey", {spy: true});

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

describe('ResourceCache', () => {
    test('concurrent loads with the same arguments share one request', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);

        const first = cache.load('a');
        const second = cache.load('a');

        expect(loader.calls).toEqual(['a']);

        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await Promise.all([first, second]);

        expect(cache.getEntry('a').data).toEqual({id: 'a', name: 'Ann'});
    });

    test('different arguments are independent entries', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);

        void cache.load('a');
        void cache.load('b');

        expect(loader.calls).toEqual(['a', 'b']);

        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        // Resolving one does not abort or disturb the other, unlike a single-slot resource.
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Success);
        expect(cache.getEntry('b').status).toEqual(EResourceStatus.Pending);

        loader.pending[1].resolve({id: 'b', name: 'Bob'});
        await flush();

        expect(cache.getEntry('b').data).toEqual({id: 'b', name: 'Bob'});
        expect(cache.getEntry('a').data).toEqual({id: 'a', name: 'Ann'});
    });

    test('a fresh entry is served without calling the loader again', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 60_000});

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        await cache.load('a');

        expect(loader.calls).toEqual(['a']);
        expect(cache.getEntry('a').stale).toBeFalsy();
    });

    test('an entry past its lifetime is stale and is fetched again', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 0});

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        // Any age above the lifetime counts, and `flush` already took a turn of the event loop.
        await new Promise(resolve => setTimeout(resolve, 5));

        expect(cache.getEntry('a').stale).toBeTruthy();
        // The stale answer is still there to show while the new one is on its way.
        expect(cache.getEntry('a').data).toEqual({id: 'a', name: 'Ann'});

        void cache.load('a');

        expect(loader.calls).toEqual(['a', 'a']);
    });

    test('an infinite lifetime never goes stale', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: Infinity});

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        expect(cache.getEntry('a').stale).toBeFalsy();
    });

    test('refreshing an entry that has data keeps it readable', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: -1});

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        void cache.load('a');

        const entry = cache.getEntry('a');

        // No flash of Pending over data the user is reading.
        expect(entry.status).toEqual(EResourceStatus.Success);
        expect(entry.data).toEqual({id: 'a', name: 'Ann'});
        expect(entry.refreshing).toBeTruthy();
    });

    test('a component reading one entry is not woken by another entry', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);
        let readerOfA = 0;

        cache.subscribe(() => readerOfA++, {
            id: 'a-reader',
            reads: readsOf(`entries.${cache.keyOf('a')}.data`),
        });

        void cache.load('b');
        loader.pending[0].resolve({id: 'b', name: 'Bob'});
        await flush();

        expect(readerOfA).toEqual(0);

        void cache.load('a');
        loader.pending[1].resolve({id: 'a', name: 'Ann'});
        await flush();

        expect(readerOfA).toBeGreaterThan(0);
    });

    test('reading an entry does not write to the store', () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);
        const before = cache.getVersion();

        cache.getEntry('a');
        cache.getEntry('b');

        expect(cache.getVersion()).toEqual(before);
        expect(loader.calls).toEqual([]);
    });

    test('an unknown entry reads as idle and stale', () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);
        const entry = cache.getEntry('missing');

        expect(entry.status).toEqual(EResourceStatus.Idle);
        expect(entry.data).toBeUndefined();
        expect(entry.stale).toBeTruthy();
    });

    test('aborting leaves no entry claiming to be pending', () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);

        void cache.load('a');
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Pending);

        cache.abort('a');

        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(loader.pending[0].signal.aborted).toBeTruthy();
    });

    test('a request that settles after being aborted does not overwrite the entry', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);

        void cache.load('a');
        cache.abort('a');

        void cache.load('a');
        loader.pending[1].resolve({id: 'a', name: 'second'});
        await flush();

        // The abandoned first request answers last, and must be ignored.
        loader.pending[0].resolve({id: 'a', name: 'first'});
        await flush();

        expect(cache.getEntry('a').data).toEqual({id: 'a', name: 'second'});
    });

    test('abortAll cancels every request in flight', () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);

        void cache.load('a');
        void cache.load('b');

        cache.abortAll();

        expect(loader.pending[0].signal.aborted).toBeTruthy();
        expect(loader.pending[1].signal.aborted).toBeTruthy();
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getEntry('b').status).toEqual(EResourceStatus.Idle);
    });

    test('a first load that fails becomes an error with the message and the raw rejection', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);
        const failure = new Error('network down');

        const request = cache.load('a');

        loader.pending[0].reject(failure);
        await request;

        const entry = cache.getEntry('a');

        expect(entry.status).toEqual(EResourceStatus.Error);
        // Even without prior data, the failure is recorded on the entry itself.
        expect(entry.failed).toBeTruthy();
        expect(entry.error).toEqual('network down');
        expect(entry.data).toBeUndefined();
        // The serializable state carries the message; the rejection itself is kept beside it.
        expect(cache.getFailure('a')).toBe(failure);
    });

    test('a loader that throws synchronously settles the entry like a rejection', async () => {
        const calls: string[] = [];
        const failure = new Error('thrown');
        let aCalls = 0;

        const cache = new ResourceCache<IUser, string>((id) => {
            calls.push(id);

            if (id === 'a') {
                aCalls += 1;

                if (aCalls === 1) {
                    throw failure;
                }
            }

            return Promise.resolve({id, name: id.toUpperCase()});
        });

        await cache.load('a');

        const entry = cache.getEntry('a');

        expect(entry.status).toEqual(EResourceStatus.Error);
        expect(entry.error).toEqual('thrown');
        expect(entry.failed).toBeTruthy();
        expect(cache.getFailure('a')).toBe(failure);

        // The throw never touched the other entries.
        await cache.load('b');
        expect(cache.getEntry('b').status).toEqual(EResourceStatus.Success);

        // The failed key retries instead of staying wedged.
        await cache.load('a');
        expect(calls).toEqual(['a', 'b', 'a']);
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Success);
    });

    test('a failure leaves the entry stale, so asking again retries', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 60_000});

        const request = cache.load('a');
        loader.pending[0].reject(new Error('nope'));
        await request;

        // updatedAt records when data was obtained, and a failure obtained none.
        expect(cache.getEntry('a').stale).toBeTruthy();

        void cache.load('a');
        expect(loader.calls).toEqual(['a', 'a']);
    });

    test('arguments are keyed by value, not by identity', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, {id: string}>((args, signal) => loader.load(args.id, signal));

        void cache.load({id: 'a'});
        void cache.load({id: 'a'});

        expect(loader.calls).toEqual(['a']);
        expect(cache.keyOf({id: 'a'})).toEqual(cache.keyOf({id: 'a'}));
    });

    test('repeated reads of an unchanged entry share one view object', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 60_000});

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        const first = cache.getEntry('a');
        const second = cache.getEntry('a');

        expect(second).toBe(first);
        expect(second.data).toEqual({id: 'a', name: 'Ann'});
    });

    test('a settled answer replaces the view object for its key', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 60_000});

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        const before = cache.getEntry('a');

        void cache.refresh('a');
        loader.pending[1].resolve({id: 'a', name: 'Anna'});
        await flush();

        const after = cache.getEntry('a');

        expect(after).not.toBe(before);
        expect(after.data).toEqual({id: 'a', name: 'Anna'});
        expect(after.updatedAt as number).toBeGreaterThanOrEqual(before.updatedAt as number);
    });

    test('an invalidation replaces the view object without touching the data', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 60_000});

        void cache.load('a');
        loader.pending[0].resolve({id: 'a', name: 'Ann'});
        await flush();

        const before = cache.getEntry('a');

        cache.invalidate('a');

        const after = cache.getEntry('a');

        expect(after).not.toBe(before);
        expect(after.stale).toBe(true);
        expect(after.data).toEqual({id: 'a', name: 'Ann'});
    });

    test('an entry crossing its ttl gets a fresh view object with no write in between', async () => {
        // A fake clock, not a tight real-time race: `isStale` reads Date.now(), and a real
        // 50ms window can already have elapsed under load by the time `fresh` is read, making
        // the "still fresh" assertion below flake independent of anything this test verifies.
        rstest.useFakeTimers();

        try {
            const loader = makeLoader();
            const cache = new ResourceCache<IUser, string>(loader.load, {ttl: 50});

            void cache.load('a');
            loader.pending[0].resolve({id: 'a', name: 'Ann'});
            await rstest.advanceTimersByTimeAsync(0);

            const fresh = cache.getEntry('a');

            expect(fresh.stale).toBe(false);

            await rstest.advanceTimersByTimeAsync(120);

            const expired = cache.getEntry('a');

            expect(expired).not.toBe(fresh);
            expect(expired.stale).toBe(true);
            expect(expired.data).toEqual({id: 'a', name: 'Ann'});
            // Time alone moved the verdict; the loader was never asked again.
            expect(loader.calls).toEqual(['a']);
        } finally {
            rstest.useRealTimers();
        }
    });

    test('reads of an absent key are never cached', () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);
        const viewCache = () => (cache as unknown as {viewCache: Map<string, unknown>}).viewCache;

        const first = cache.getEntry('missing');

        for (let index = 0; index < 50; index++) {
            cache.getEntry(`absent-${index}`);
        }

        const again = cache.getEntry('missing');

        // Built fresh every time, and no bookkeeping for keys that never loaded.
        expect(again).not.toBe(first);
        expect(again).toEqual(first);
        expect(viewCache().size).toEqual(0);
    });

    test('one pathOf plus one getEntry serializes the arguments once per lookup, cold and warm', () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, {id: string}>((args, signal) => loader.load(args.id, signal));
        const args = {id: 'a'};

        // Spying JSON.stringify itself, not encodeCacheKey: since R7-05 the cache escapes its own
        // JSON and the public encoder is no longer on the read path, so stringify count is the
        // honest measure of "one render does not over-serialize".
        const stringify = rstest.spyOn(JSON, 'stringify');

        try {
            // mockClear first: earlier tests in this file also encoded keys.
            rstest.mocked(encodeCacheKey).mockClear();
            stringify.mockClear();

            // Cold pass: pathOf encodes — one stringify, then the JSON string is escaped, not
            // re-stringified — and getEntry validates the memo with its own stringify (R6-05 makes
            // that one unavoidable). Two, where the R7 report measured three.
            cache.pathOf(args);
            cache.getEntry(args);

            expect(stringify).toHaveBeenCalledTimes(2);
            expect(encodeCacheKey).not.toHaveBeenCalled();

            // Warm pass: both lookups are memo hits; each still pays its single validation stringify.
            stringify.mockClear();

            cache.pathOf(args);
            cache.getEntry(args);

            expect(stringify).toHaveBeenCalledTimes(2);
        } finally {
            stringify.mockRestore();
        }
    });

    test('a reader of an entry whose key holds the separator is woken when it settles', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);

        let notified = 0;
        cache.subscribe(() => notified++, {id: 'reader', reads: readsOf(cache.pathOf('a.b'))});

        void cache.load('a.b');
        loader.pending[0].resolve({id: 'a.b', name: 'Ann'});
        await flush();

        // The written path and the subscribed path come out of the same escape, or a key
        // holding `.` or `~` never hears anything again.
        expect(notified).toBeGreaterThan(0);
    });

    test('settling one escaped entry wakes only its own reader', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<IUser, string>(loader.load);

        // Subscribed after both requests are in flight: each reader must not be counted
        // against the pending write its own entry legitimately sends when its load starts.
        void cache.load('a.b');
        void cache.load('a~b');

        let readerOfDot = 0;
        let readerOfTilde = 0;
        cache.subscribe(() => readerOfDot++, {id: 'dot', reads: readsOf(cache.pathOf('a.b'))});
        cache.subscribe(() => readerOfTilde++, {id: 'tilde', reads: readsOf(cache.pathOf('a~b'))});

        loader.pending[0].resolve({id: 'a.b', name: 'Ann'});
        await flush();

        expect(readerOfDot).toBeGreaterThan(0);
        expect(readerOfTilde).toEqual(0);

        loader.pending[1].resolve({id: 'a~b', name: 'Bob'});
        await flush();

        expect(readerOfTilde).toBeGreaterThan(0);
    });
});

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
