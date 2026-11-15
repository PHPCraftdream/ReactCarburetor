import {Carburetor, ResourceCache, ResourceCarburetor, carburetorToken} from '@/Carburetor';
import {storeLifecycle} from '@/Carburetor/Store/Diagnostics/Internal/StoreLifecycle';
import {createTestClock, createTestScope} from '@/Testing';

/** How far wall time may have moved between two reads inside one test. */
const WALL_SLACK = 1000;

describe('a store\'s time', () => {
    test('is wall time until a clock is attached, and the clock\'s own time afterwards', () => {
        const store = new Carburetor({n: 0});
        const other = new Carburetor({n: 0});
        const clock = createTestClock();

        expect(Math.abs(storeLifecycle.now(store) - Date.now())).toBeLessThan(WALL_SLACK);

        clock.attach(store);
        const attached = storeLifecycle.now(store);

        expect(Math.abs(attached - Date.now())).toBeLessThan(WALL_SLACK);

        clock.advance(1000);

        expect(storeLifecycle.now(store) - attached).toBe(1000);
        // A store that never got a clock keeps the wall clock, whatever the clock does.
        expect(Math.abs(storeLifecycle.now(other) - Date.now())).toBeLessThan(WALL_SLACK);
    });

    test('stays continuous when another clock takes over, then follows the new one', () => {
        const store = new Carburetor({n: 0});
        const first = createTestClock();
        const second = createTestClock();

        first.attach(store);
        first.advance(700);

        const before = storeLifecycle.now(store);

        second.attach(store);

        expect(storeLifecycle.now(store)).toBe(before);

        second.advance(50);
        first.advance(9999);

        expect(storeLifecycle.now(store)).toBe(before + 50);
    });
});

describe('resource freshness on a test clock', () => {
    test('a cache entry goes stale exactly when the clock passes its ttl, not when wall time does', async () => {
        const clock = createTestClock();
        let calls = 0;
        const cache = new ResourceCache<number, [string]>(async () => ++calls, {ttl: 1000});

        clock.attach(cache);

        await cache.load('a');
        await cache.load('a');
        expect(calls).toBe(1);

        clock.advance(1000);
        await cache.load('a');
        expect(calls).toBe(1);

        clock.advance(1);
        await cache.load('a');
        expect(calls).toBe(2);
    });

    test('an entry loaded before the clock was attached keeps its wall stamp and ages with the clock', async () => {
        let calls = 0;
        const cache = new ResourceCache<number, [string]>(async () => ++calls, {ttl: 1000});

        await cache.load('a');

        const clock = createTestClock();

        clock.attach(cache);
        clock.advance(500);
        await cache.load('a');
        expect(calls).toBe(1);

        clock.advance(600);
        await cache.load('a');
        expect(calls).toBe(2);
    });

    test('a resource\'s remembered answers expire by the clock too', async () => {
        const clock = createTestClock();
        const requested: string[] = [];
        const resource = new ResourceCarburetor<string, [string]>(async (id) => {
            requested.push(id);

            return id + requested.length;
        }, {ttl: 1000});

        clock.attach(resource);

        await resource.load('a');
        await resource.load('b');
        expect(requested).toEqual(['a', 'b']);

        // The slot holds b now; a comes back from memory while it is fresh.
        await resource.load('a');
        expect(requested).toEqual(['a', 'b']);
        expect(resource.getData().data).toBe('a1');

        clock.advance(1001);
        await resource.load('b');
        expect(requested).toEqual(['a', 'b', 'b']);
    });

    test('a store handed out by a test scope with a clock is driven by that clock', async () => {
        const clock = createTestClock();
        let calls = 0;
        const token = carburetorToken(
            () => new ResourceCache<number, [string]>(async () => ++calls, {ttl: 1000}),
            'resource-clock/scoped-cache',
        );
        const scope = createTestScope(undefined, {clock});

        try {
            const cache = scope.get(token);

            await cache.load('a');
            clock.advance(1001);
            await cache.load('a');

            expect(calls).toBe(2);
        } finally {
            scope.dispose();
        }
    });
});
