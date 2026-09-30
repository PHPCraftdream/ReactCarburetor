import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';

const controlled = () => {
    const calls: string[] = [];
    const pending: Array<PromiseWithResolvers<string>> = [];
    const cache = new ResourceCache<string, string>((key) => {
        calls.push(key);
        const request = Promise.withResolvers<string>();
        pending.push(request);
        return request.promise;
    }, {ttl: Infinity});

    return {cache, calls, pending};
};

test.each([
    ['initial', 'invalidate', 'success'],
    ['initial', 'invalidateAll', 'success'],
    ['refresh', 'invalidate', 'success'],
    ['refresh', 'invalidateAll', 'success'],
    ['initial', 'invalidate', 'failure'],
    ['initial', 'invalidateAll', 'failure'],
    ['refresh', 'invalidate', 'failure'],
    ['refresh', 'invalidateAll', 'failure'],
] as const)('%s %s survives an older %s answer until the next read', async (phase, method, answer) => {
    const {cache, calls, pending} = controlled();
    if (phase === 'refresh') {
        const initial = cache.load('a');
        pending[0].resolve('original');
        await initial;
    }

    const old = phase === 'initial' ? cache.load('a') : cache.refresh('a');
    const oldIndex = pending.length - 1;
    if (method === 'invalidate') {
        cache.invalidate('a');
    } else {
        cache.invalidateAll();
    }
    expect(calls).toHaveLength(oldIndex + 1);
    expect(cache.getEntry('a').invalidated).toBe(true);
    expect(cache.getEntry('a').data).toBe(phase === 'refresh' ? 'original' : undefined);

    if (answer === 'success') {
        pending[oldIndex].resolve('older');
    } else {
        pending[oldIndex].reject(new Error('older failure'));
    }
    await old;

    const view = cache.getEntry('a');
    expect(view.invalidated).toBe(true);
    expect(view.stale).toBe(true);
    expect(view.failed).toBe(false);
    expect(view.status).toBe(answer === 'failure' && phase === 'initial'
        ? EResourceStatus.Error : EResourceStatus.Success);
    expect(view.data).toBe(answer === 'success' ? 'older' : phase === 'refresh' ? 'original' : undefined);

    const next = cache.load('a');
    expect(calls).toHaveLength(oldIndex + 2);
    pending[oldIndex + 1].resolve('newer');
    await next;
    expect(cache.getEntry('a')).toMatchObject({data: 'newer', stale: false, invalidated: false, failed: false});
    await cache.load('a');
    expect(calls).toHaveLength(oldIndex + 2);
});

test('a second explicit invalidation during the re-armed request remains outstanding', async () => {
    const {cache, calls, pending} = controlled();
    const first = cache.load('a');
    cache.invalidate('a');
    pending[0].resolve('before first invalidation');
    await first;

    const second = cache.load('a');
    cache.invalidateAll();
    pending[1].resolve('before second invalidation');
    await second;
    expect(cache.getEntry('a')).toMatchObject({data: 'before second invalidation', stale: true});

    const third = cache.load('a');
    expect(calls).toEqual(['a', 'a', 'a']);
    pending[2].resolve('latest');
    await third;
    expect(cache.getEntry('a')).toMatchObject({data: 'latest', stale: false});
});

test('invalidating one key leaves another in-flight request untouched', async () => {
    const {cache, calls, pending} = controlled();
    const a = cache.load('a');
    const b = cache.load('b');
    cache.invalidate('a');
    pending[0].resolve('old a');
    pending[1].resolve('b');
    await Promise.all([a, b]);

    expect(cache.getEntry('a')).toMatchObject({data: 'old a', stale: true});
    expect(cache.getEntry('b')).toMatchObject({data: 'b', stale: false});
    await cache.load('b');
    expect(calls).toEqual(['a', 'b']);
    const next = cache.load('a');
    pending[2].resolve('new a');
    await next;
    expect(cache.getEntry('a')).toMatchObject({data: 'new a', stale: false});
});
