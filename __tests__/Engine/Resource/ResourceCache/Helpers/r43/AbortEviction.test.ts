import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {R} from '@/Carburetor/Store/Diagnostics/Internal/ResourceSymbols';
import {TestCache} from '../TestCache';

const compareKeys = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const fixture = (ttl = Infinity, maxEntries = 1) => {
    const requests: Array<{
        key: string;
        signal: AbortSignal;
        resolve: (value: string) => void;
        reject: (error: unknown) => void;
    }> = [];
    const promises: Promise<void>[] = [];
    const ids: string[] = [];
    const cache = new TestCache<string, string>((key, signal) => new Promise((resolve, reject) => {
        requests.push({key, signal, resolve, reject});
    }), {ttl, maxEntries});
    const start = (key: string, refresh = false) => {
        const promise = refresh ? cache.refresh(key) : cache.load(key);
        promises.push(promise);
        return promise;
    };
    const kept = () => Object.keys(cache.getData().entries).sort(compareKeys);
    const keys = (...args: string[]) => args.map(key => cache.exposeKeyOf(key)).sort(compareKeys);
    const close = async () => {
        ids.forEach(id => cache.unsubscribe(id));
        cache.abortAll();
        requests.forEach(request => request.resolve('cleanup'));
        await Promise.all(promises);
        cache.forgetAll();
    };
    return {cache, requests, promises, ids, start, kept, keys, close};
};

describe('ResourceCache post-start cancellation capacity', () => {
    for (const ttl of [0, Infinity]) {
        for (const phase of ['initial', 'refresh'] as const) {
            test(`abortAll preserves ${phase} data until the next paused load reclaims a/b (ttl=${ttl})`, async () => {
                const f = fixture(ttl);
                try {
                    if (phase === 'refresh') {
                        const warm = f.start('a');
                        f.requests[0].resolve('old-a');
                        await warm;
                    }
                    const a = f.start('a', phase === 'refresh');
                    const aRequest = f.requests[f.requests.length - 1];
                    const b = f.start('b');
                    const bRequest = f.requests[f.requests.length - 1];
                    expect(f.kept()).toEqual(f.keys('a', 'b'));
                    expect(aRequest.signal.aborted).toBe(false);
                    expect(bRequest.signal.aborted).toBe(false);
                    const seen = [0, 0];
                    f.ids.push(f.cache.subscribe(() => { seen[0]++; }));
                    f.ids.push(f.cache.subscribe(() => { seen[1]++; }, {
                        reads: new Set([f.cache.exposePathOf('missing')]),
                    }));
                    const before = f.cache.getVersion();

                    f.cache.abortAll();

                    expect(f.cache.getVersion() - before).toBe(1);
                    expect(seen).toEqual([1, 0]);
                    expect(f.kept()).toEqual(f.keys('a', 'b'));
                    expect(f.cache.getEntry('a')).toMatchObject({
                        status: phase === 'refresh' ? EResourceStatus.Success : EResourceStatus.Idle,
                        data: phase === 'refresh' ? 'old-a' : undefined,
                        refreshing: false, failed: false,
                    });
                    expect(f.cache.getEntry('b').status).toBe(EResourceStatus.Idle);
                    expect(aRequest.signal.aborted).toBe(true);
                    expect(bRequest.signal.aborted).toBe(true);

                    f.start('c');

                    expect(f.kept()).toEqual(f.keys('c'));
                    expect(f.cache.getEntry('c').status).toBe(EResourceStatus.Pending);
                    expect(f.requests.map(request => request.key)).toEqual(
                        phase === 'refresh' ? ['a', 'a', 'b', 'c'] : ['a', 'b', 'c'],
                    );
                    const retiredVersion = f.cache.getVersion();
                    const retiredSeen = [...seen];
                    aRequest.resolve('late-a');
                    bRequest.reject(new Error('late-b'));
                    await Promise.all([a, b]);
                    expect(f.cache.getVersion()).toBe(retiredVersion);
                    expect(seen).toEqual(retiredSeen);
                    expect(f.kept()).toEqual(f.keys('c'));
                    expect(f.cache.getFailure('b')).toBeUndefined();
                } finally {
                    await f.close();
                }
            });
        }
    }

    test('individual abort reclaims only a and leaves b plus paused c (count=2)', async () => {
        const f = fixture();
        try {
            const a = f.start('a');
            f.start('b');
            f.cache.abort('a');
            expect(f.kept()).toEqual(f.keys('a', 'b'));
            expect(f.requests[0].signal.aborted).toBe(true);
            expect(f.requests[1].signal.aborted).toBe(false);
            f.start('c');
            expect(f.kept()).toEqual(f.keys('b', 'c'));
            expect(f.cache.getEntry('b').status).toBe(EResourceStatus.Pending);
            expect(f.cache.getEntry('c').status).toBe(EResourceStatus.Pending);
            const before = f.cache.getVersion();
            f.requests[0].reject(new Error('retired'));
            await a;
            expect(f.cache.getVersion()).toBe(before);
            expect(f.requests.map(request => request.key)).toEqual(['a', 'b', 'c']);
        } finally {
            await f.close();
        }
    });

    test('synchronous same-key abort-listener replacement remains protected under pressure', async () => {
        const f = fixture();
        try {
            const retired = f.start('a');
            f.start('b');
            f.requests[0].signal.addEventListener('abort', () => { f.start('a'); }, {once: true});
            f.cache.abortAll();
            expect(f.requests.map(request => request.key)).toEqual(['a', 'b', 'a']);
            expect(f.requests.map(request => request.signal.aborted)).toEqual([true, true, false]);
            f.start('c');
            expect(f.kept()).toEqual(f.keys('a', 'c'));
            expect(f.cache.getEntry('a').status).toBe(EResourceStatus.Pending);
            const before = f.cache.getVersion();
            f.requests[0].resolve('retired-a');
            await retired;
            expect(f.cache.getVersion()).toBe(before);
            expect(f.cache.getEntry('a').data).toBeUndefined();
            f.requests[3].resolve('current-c');
            await f.promises[3];
            expect(f.kept()).toEqual(f.keys('a'));
            f.requests[2].resolve('replacement-a');
            await f.promises[2];
            expect(f.cache.getEntry('a').data).toBe('replacement-a');
        } finally {
            await f.close();
        }
    });

    for (const method of ['setData', 'restore'] as const) {
        for (const phase of ['initial', 'refresh'] as const) {
            test(`${method} abort reentry preserves replacement ${phase} without a request`, async () => {
                const f = fixture();
                try {
                    if (phase === 'refresh') {
                        const warm = f.start('a');
                        f.requests[0].resolve('old-a');
                        await warm;
                    }
                    const retired = f.start('a', phase === 'refresh');
                    const request = f.requests[f.requests.length - 1];
                    const key = f.cache.exposeKeyOf('a');
                    const replacement = {entries: {[key]: {
                        ...f.cache.getData().entries[key],
                        data: 'replacement-a',
                    }}};
                    let installed = f.cache.getData();
                    request.signal.addEventListener('abort', () => {
                        f.cache[method](replacement);
                        installed = f.cache.getData();
                    }, {once: true});
                    let seen = 0;
                    f.ids.push(f.cache.subscribe(() => { seen++; }));
                    const before = f.cache.getVersion();

                    f.cache.abort('a');

                    expect(request.signal.aborted).toBe(true);
                    expect(f.requests).toHaveLength(phase === 'refresh' ? 2 : 1);
                    expect(f.cache[R.hasRequest](key)).toBe(false);
                    expect(f.cache.getData()).toBe(installed);
                    expect(f.cache.getData().entries[key]).toEqual({
                        ...replacement.entries[key],
                        status: method === 'restore' && phase === 'initial'
                            ? EResourceStatus.Idle : replacement.entries[key].status,
                        refreshing: method === 'setData' && phase === 'refresh',
                    });
                    expect(f.cache.getVersion() - before).toBe(1);
                    expect(seen).toBe(1);
                    if (phase === 'initial') request.resolve('retired-a');
                    else request.reject(new Error('retired-a'));
                    await retired;
                    expect(f.cache.getData()).toBe(installed);
                    expect(f.cache.getFailure('a')).toBeUndefined();
                    expect(f.cache.getVersion() - before).toBe(1);
                    expect(seen).toBe(1);
                } finally {
                    await f.close();
                }
            });
        }
    }

    test('synchronous abort-listener forget removes the key without an extra abort publication', async () => {
        const f = fixture();
        try {
            const retired = f.start('a');
            f.requests[0].signal.addEventListener('abort', () => { f.cache.forget('a'); }, {once: true});
            let seen = 0;
            f.ids.push(f.cache.subscribe(() => { seen++; }));
            const before = f.cache.getVersion();
            f.cache.abort('a');
            expect(f.requests[0].signal.aborted).toBe(true);
            expect(f.kept()).toEqual([]);
            expect(f.cache.getVersion() - before).toBe(1);
            expect(seen).toBe(1);
            f.requests[0].reject(new Error('retired-a'));
            await retired;
            expect(f.kept()).toEqual([]);
            expect(f.cache.getVersion() - before).toBe(1);
            expect(seen).toBe(1);
        } finally {
            await f.close();
        }
    });

    test('abort with missing state cancels only its runtime and empty aborts do not publish', async () => {
        const f = fixture();
        try {
            const retired = f.start('a');
            f.cache.setData({entries: {}});
            const key = f.cache.exposeKeyOf('a');
            const state = f.cache.getData();
            let seen = 0;
            f.ids.push(f.cache.subscribe(() => { seen++; }));
            const before = f.cache.getVersion();
            f.cache.abort('missing');
            expect(f.requests[0].signal.aborted).toBe(false);
            expect(f.cache[R.hasRequest](key)).toBe(true);
            expect(f.cache.getVersion()).toBe(before);
            expect(seen).toBe(0);
            f.cache.abort('a');
            f.cache.abort('a');
            f.cache.abortAll();
            expect(f.requests[0].signal.aborted).toBe(true);
            expect(f.cache[R.hasRequest](key)).toBe(false);
            expect(f.cache.getData()).toBe(state);
            expect(f.kept()).toEqual([]);
            expect(f.cache.getVersion()).toBe(before);
            expect(seen).toBe(0);
            f.requests[0].resolve('retired-a');
            await retired;
            expect(f.cache.getData()).toBe(state);
            expect(f.cache.getVersion()).toBe(before);
            expect(seen).toBe(0);
        } finally {
            await f.close();
        }
    });

    test('reader-held cancelled a survives pressure while unretained b is reclaimed', async () => {
        const f = fixture();
        try {
            f.start('a');
            f.start('b');
            f.ids.push(f.cache.subscribe(() => undefined, {
                reads: new Set([`${f.cache.exposePathOf('a')}.data`]),
            }));
            f.cache.abortAll();
            f.start('c');
            expect(f.kept()).toEqual(f.keys('a', 'c'));
            expect(f.cache.getEntry('a').status).toBe(EResourceStatus.Idle);
            expect(f.cache.getEntry('c').status).toBe(EResourceStatus.Pending);
            expect(f.requests).toHaveLength(3);
        } finally {
            await f.close();
        }
    });

    test('aborted failed refresh keeps raw failure and blocks automatic retry until invalidation', async () => {
        const f = fixture();
        try {
            const warm = f.start('a');
            f.requests[0].resolve('old-a');
            await warm;
            const failure = new Error('offline');
            const failed = f.start('a', true);
            f.requests[1].reject(failure);
            await failed;
            expect(f.cache.getFailure('a')).toBe(failure);
            f.cache.invalidate('a');
            const retry = f.start('a', true);
            f.start('b');
            f.ids.push(f.cache.subscribe(() => undefined, {
                reads: new Set([`${f.cache.exposePathOf('a')}.data`]),
            }));
            f.cache.abortAll();
            expect(f.cache.getEntry('a')).toMatchObject({data: 'old-a', failed: true, refreshing: false});
            expect(f.cache.getFailure('a')).toBe(failure);
            expect(f.cache.suspend('a')).toBe('old-a');
            expect(f.requests).toHaveLength(4);
            f.start('c');
            expect(f.kept()).toEqual(f.keys('a', 'c'));
            const before = f.cache.getVersion();
            f.requests[2].resolve('retired-retry');
            await retry;
            expect(f.cache.getVersion()).toBe(before);
            expect(f.cache.getFailure('a')).toBe(failure);
            f.cache.invalidate('a');
            const fresh = f.start('a', true);
            f.requests[5].resolve('fresh-a');
            await fresh;
            expect(f.cache.getEntry('a')).toMatchObject({data: 'fresh-a', failed: false, refreshing: false});
            expect(f.cache.getFailure('a')).toBeUndefined();
            expect(f.requests.map(request => request.key)).toEqual(['a', 'a', 'a', 'b', 'c', 'a']);
        } finally {
            await f.close();
        }
    });
});
