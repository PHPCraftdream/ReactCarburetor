import {ResourceCache} from '@/Carburetor';
import {joinPath} from '@/Carburetor/Store/Paths/joinPath';

interface IPending {resolve: (value: number) => void}

/** A cache whose loader answers only when the test says so, per key. */
const deferredCache = (): {cache: ResourceCache<number, [string]>; pending: Map<string, IPending>} => {
    const pending = new Map<string, IPending>();
    const cache = new ResourceCache<number, [string]>(
        (id: string) => new Promise<number>(resolve => { pending.set(id, {resolve}); })
    );

    return {cache, pending};
};

const field = (cache: ResourceCache<number, [string]>, id: string, name: string): string =>
    joinPath(cache.resolve(id).path, name);

describe('a reader of an absent cache entry', () => {
    test('a data-only reader sleeps through the Pending creation and wakes on the answer', async () => {
        const {cache, pending} = deferredCache();
        let wakes = 0;

        cache.subscribe(() => { wakes++; }, {reads: new Set([field(cache, 'a', 'data')])});

        const loading = cache.load('a');

        expect(cache.resolve('a').view.status).toBe('pending');
        expect(wakes).toBe(0);

        pending.get('a')?.resolve(5);
        await loading;

        expect(cache.resolve('a').view.data).toBe(5);
        expect(wakes).toBe(1);
    });

    test('a status reader is woken by the Pending creation itself', async () => {
        const {cache, pending} = deferredCache();
        let wakes = 0;

        cache.subscribe(() => { wakes++; }, {reads: new Set([field(cache, 'a', 'status')])});

        const loading = cache.load('a');

        expect(wakes).toBe(1);

        pending.get('a')?.resolve(5);
        await loading;

        expect(wakes).toBe(2);
    });

    test('a reader of two absent entries sleeps through both creations, then wakes on the first answer', async () => {
        const {cache, pending} = deferredCache();
        let wakes = 0;

        cache.subscribe(
            () => { wakes++; },
            {reads: new Set([field(cache, 'a', 'data'), field(cache, 'b', 'data')])}
        );

        const first = cache.load('a');
        const second = cache.load('b');

        expect(wakes).toBe(0);

        pending.get('b')?.resolve(2);
        await second;

        expect(wakes).toBe(1);

        pending.get('a')?.resolve(1);
        await first;

        expect(wakes).toBe(2);
    });

    test('an entry removed while the reader still waits wakes it, so it can ask again', () => {
        const {cache} = deferredCache();
        let wakes = 0;

        cache.subscribe(
            () => { wakes++; },
            {reads: new Set([field(cache, 'a', 'data'), field(cache, 'b', 'data')])}
        );

        void cache.load('a').catch(() => undefined);

        expect(wakes).toBe(0);

        cache.forget('a');

        expect(cache.resolve('a').present).toBe(false);
        expect(wakes).toBe(1);
    });
});
