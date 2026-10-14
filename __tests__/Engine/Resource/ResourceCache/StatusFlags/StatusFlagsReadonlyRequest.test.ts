import {EResourceStatus, ResourceCache} from '@/Carburetor';
import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';

describe('ResourceCache status flags capability on request start (F3)', () => {
    test('load succeeds when the seeded entry has a readonly non-configurable isIdle', async () => {
        const cache = new ResourceCache<string, string>(async key => `answer-${key}`, {ttl: Infinity});
        const key = cache.resolve('a').key;

        // Seed a correct Idle entry whose isIdle flag is frozen: readonly and
        // non-configurable, while every other field stays writable.
        const entry = {
            status: EResourceStatus.Idle,
            isIdle: true, isPending: false, isSuccess: false, isError: false,
            data: undefined, error: undefined, updatedAt: undefined,
            refreshing: false, invalidated: false, failed: false,
        };
        Object.defineProperty(entry, 'isIdle', {
            value: true, writable: false, configurable: false, enumerable: true,
        });
        cache.setData({entries: {[key]: entry}} as unknown as IResourceCacheData<string>);

        // The request start capability check ignores the status flags; the load must not
        // throw on the readonly flag write and the operational entry must not keep it.
        await expect(cache.load('a')).resolves.toBeUndefined();

        const loaded = cache.getEntry('a') as IResourceEntry<string>;
        expect(loaded.status).toBe(EResourceStatus.Success);
        expect(loaded.isSuccess).toBe(true);
        expect(loaded.isIdle).toBe(false);
        expect(loaded.data).toBe('answer-a');

        // The original seeded entry object was replaced, not mutated in place.
        expect(entry.isIdle).toBe(true);
        expect(entry.status).toBe(EResourceStatus.Idle);
    });
});
