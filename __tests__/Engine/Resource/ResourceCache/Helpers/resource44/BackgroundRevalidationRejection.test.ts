import {EResourceStatus as S, ResourceCache} from '@/Carburetor';

describe('resource44 stale background revalidation', () => {
    test('suspend keeps the background rejection owned when the description throws', async () => {
        const sentinel = new Error('description threw');
        const raw = {toString: (): string => { throw sentinel; }};
        let call = 0;
        const cache = new ResourceCache<string, [string]>(
            () => ++call === 1 ? Promise.resolve('value') : Promise.reject(raw), {ttl: 0});
        await cache.load('a');
        await new Promise(done => setImmediate(done));
        await new Promise(done => setTimeout(done, 5));
        expect(cache.suspend('a')).toBe('value');
        const unhandled: unknown[] = [];
        const observe = (reason: unknown): void => { unhandled.push(reason); };
        process.on('unhandledRejection', observe);
        try {
            await new Promise(done => setImmediate(done));
            await new Promise(done => setImmediate(done));
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', observe);
        }
        // A failed refresh keeps the previous answer and records the failure beside it.
        expect(cache.getEntry('a')).toMatchObject({status: S.Success, data: 'value', failed: true});
        expect(typeof cache.getEntry('a').error).toBe('string');
        expect((cache.getEntry('a').error as string).length).toBeGreaterThan(0);
        await expect(cache.load('a')).rejects.toBe(sentinel);
    });
});
