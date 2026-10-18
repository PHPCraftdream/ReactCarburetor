import {Carburetor, ComponentUpdateThrottle, IStorageLike, persist} from '@/Carburetor';

class MemoryStorage implements IStorageLike {
    public entries = new Map<string, string>();
    public writtenKeys: string[] = [];

    public getItem(key: string): string | null {
        return this.entries.get(key) ?? null;
    }

    public setItem(key: string, value: string): void {
        this.writtenKeys.push(key);
        this.entries.set(key, value);
    }

    public removeItem(key: string): void {
        this.entries.delete(key);
    }
}

const settle = (): Promise<void> => new Promise<void>(resolve => queueMicrotask(() => resolve(undefined)));
const wait = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Replaces Date.now and the timer functions persist schedules with a hand-advanced fake
 * clock, so a throttle window cannot depend on process speed or the system clock. Every
 * caller must invoke restore() in a finally block.
 */
const useFakeClock = (): {advance: (ms: number) => void; restore: () => void} => {
    const realDateNow = Date.now;
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    let fakeNow = 1_000_000;
    let timers: Array<{callback: () => void}> = [];

    Date.now = (): number => fakeNow;
    globalThis.setTimeout = ((callback: () => void, delay?: number) => {
        void delay;
        timers.push({callback});

        return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((handle: unknown) => {
        const scheduled = timers[Number(handle) - 1];

        if (scheduled) scheduled.callback = () => undefined;
    }) as typeof clearTimeout;

    return {
        advance: ms => {
            fakeNow += ms;
            const dueTimers = timers;
            timers = [];
            dueTimers.forEach(timer => timer.callback());
        },
        restore: () => {
            Date.now = realDateNow;
            globalThis.setTimeout = realSetTimeout;
            globalThis.clearTimeout = realClearTimeout;
        },
    };
};

describe('persist partitions', () => {
    test('stores one key per branch and rewrites only the dirty branch afterwards', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({a: {n: 1}, b: {n: 1}});
        const dispose = persist(store, {key: 'app', storage, partitions: ['a', 'b']});

        expect(storage.writtenKeys).toEqual([]);

        store.setData({a: {n: 2}, b: {n: 1}});
        await settle();

        // The first flush seals the baseline: every partition lands in storage once.
        expect(storage.writtenKeys).toEqual(['app.a', 'app.b']);
        expect(JSON.parse(storage.getItem('app.a') as string)).toEqual({n: 2});
        expect(JSON.parse(storage.getItem('app.b') as string)).toEqual({n: 1});
        expect(storage.getItem('app')).toBeNull();

        storage.writtenKeys = [];
        store.setData({a: {n: 3}, b: {n: 1}});
        await settle();

        expect(storage.writtenKeys).toEqual(['app.a']);
        expect(JSON.parse(storage.getItem('app.a') as string)).toEqual({n: 3});
        expect(JSON.parse(storage.getItem('app.b') as string)).toEqual({n: 1});

        dispose();
    });

    test('restores partition entries and falls back to the legacy whole-store entry', () => {
        const storage = new MemoryStorage();
        storage.entries.set('app.a', JSON.stringify({n: 5}));
        storage.entries.set('app.b', JSON.stringify({n: 6}));

        const store = new Carburetor({a: {n: 0}, b: {n: 0}});
        const dispose = persist(store, {key: 'app', storage, partitions: ['a', 'b']});

        expect(store.getData()).toEqual({a: {n: 5}, b: {n: 6}});
        expect(storage.writtenKeys).toEqual([]);
        dispose();

        const legacy = new MemoryStorage();
        legacy.entries.set('app', JSON.stringify({a: {n: 7}, b: {n: 8}}));
        const migrated = new Carburetor({a: {n: 0}, b: {n: 0}});
        const stopMigrated = persist(migrated, {key: 'app', storage: legacy, partitions: ['a', 'b']});

        expect(migrated.getData()).toEqual({a: {n: 7}, b: {n: 8}});
        stopMigrated();
    });

    test('a branch without a stored entry keeps its current value', () => {
        const storage = new MemoryStorage();
        storage.entries.set('app.a', JSON.stringify({n: 5}));

        const store = new Carburetor({a: {n: 0}, b: {n: 9}});
        const dispose = persist(store, {key: 'app', storage, partitions: ['a', 'b']});

        expect(store.getData()).toEqual({a: {n: 5}, b: {n: 9}});

        dispose();
    });

    test('existing partition entries shadow the legacy whole-store entry', () => {
        const storage = new MemoryStorage();
        storage.entries.set('app', JSON.stringify({a: {n: 100}, b: {n: 100}}));
        storage.entries.set('app.a', JSON.stringify({n: 5}));

        const store = new Carburetor({a: {n: 0}, b: {n: 0}});
        const dispose = persist(store, {key: 'app', storage, partitions: ['a', 'b']});

        expect(store.getData()).toEqual({a: {n: 5}, b: {n: 0}});

        dispose();
    });

    test('a malformed partition entry is reported, dropped and the rest restores', () => {
        const storage = new MemoryStorage();
        storage.entries.set('app.a', '{broken');
        storage.entries.set('app.b', JSON.stringify({n: 6}));
        const errors: unknown[] = [];

        const store = new Carburetor({a: {n: 0}, b: {n: 0}});
        const dispose = persist(store, {
            key: 'app', storage, partitions: ['a', 'b'], onError: error => { errors.push(error); },
        });

        expect(errors).toHaveLength(1);
        expect(store.getData()).toEqual({a: {n: 0}, b: {n: 6}});
        expect(storage.getItem('app.a')).toBeNull();

        dispose();
    });

    test('the disposer persists an undelivered throttled write per branch', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({a: {n: 1}, b: {n: 1}}, new ComponentUpdateThrottle(40));
        const dispose = persist(store, {key: 'app', storage, partitions: ['a', 'b']});

        store.setData({a: {n: 2}, b: {n: 1}});
        dispose();

        expect(JSON.parse(storage.getItem('app.a') as string)).toEqual({n: 2});
        expect(JSON.parse(storage.getItem('app.b') as string)).toEqual({n: 1});
    });

    test('rejects partition lists that cannot be honored', () => {
        const storage = new MemoryStorage();
        expect(() => persist(new Carburetor({a: 1}), {key: 'app', storage, partitions: []})).toThrow();
        expect(() => persist(new Carburetor({a: 1}), {key: 'app', storage, partitions: ['a', 'a']})).toThrow();
        expect(() => persist(new Carburetor({'x.y': 1}), {key: 'app', storage, partitions: ['x.y']})).toThrow();
        expect(() => persist(new Carburetor({a: 1}), {key: 'app', storage, partitions: ['missing']})).toThrow();
        expect(() => persist(new Carburetor([1]), {key: 'app', storage, partitions: ['a']})).toThrow();
    });
});

describe('persist throttleMs', () => {
    test('keeps the first write immediate and folds later publications while the window is open', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({count: 0});
        // A window this wide cannot elapse during the test, so no wall-clock timing is involved.
        const dispose = persist(store, {key: 'slot', storage, throttleMs: 60000});

        store.setData({count: 1});
        await settle();

        expect(storage.writtenKeys).toEqual(['slot']);
        expect(JSON.parse(storage.getItem('slot') as string)).toEqual({count: 1});

        store.setData({count: 2});
        store.setData({count: 3});
        await wait(5);

        expect(storage.writtenKeys).toEqual(['slot']);

        dispose();

        expect(storage.writtenKeys).toEqual(['slot', 'slot']);
        expect(JSON.parse(storage.getItem('slot') as string)).toEqual({count: 3});
    });

    test('bounds the write rate across separate ticks', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {key: 'slot', storage, throttleMs: 60000});

        for (let i = 1; i <= 5; i++) {
            store.setData({count: i});
            await wait(5);
        }

        expect(storage.writtenKeys).toEqual(['slot']);

        dispose();

        expect(JSON.parse(storage.getItem('slot') as string)).toEqual({count: 5});
    });

    test('the disposer writes a state still held back by the window', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {key: 'slot', storage, throttleMs: 5000});

        store.setData({count: 1});
        store.setData({count: 2});
        dispose();

        expect(storage.writtenKeys).toEqual(['slot']);
        expect(JSON.parse(storage.getItem('slot') as string)).toEqual({count: 2});
    });

    test('throttled partitions share one window and still write only dirty branches', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({a: {n: 1}, b: {n: 1}});
        const dispose = persist(store, {key: 'app', storage, partitions: ['a', 'b'], throttleMs: 60000});

        store.setData({a: {n: 2}, b: {n: 1}});
        await settle();

        expect(storage.writtenKeys).toEqual(['app.a', 'app.b']);

        storage.writtenKeys = [];
        store.setData({a: {n: 3}, b: {n: 1}});
        await wait(5);

        // The window is still open, so nothing is written yet.
        expect(storage.writtenKeys).toEqual([]);

        // The disposer reconciles: only the dirty branch differs from what is stored.
        dispose();

        expect(storage.writtenKeys).toEqual(['app.a']);
        expect(JSON.parse(storage.getItem('app.a') as string)).toEqual({n: 3});
    });

    test('delivers the held-back write when the window elapses, without disposal', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({count: 0});
        const clock = useFakeClock();

        try {
            const dispose = persist(store, {key: 'slot', storage, throttleMs: 60000});

            store.setData({count: 1});
            await settle();

            expect(storage.writtenKeys).toEqual(['slot']);

            store.setData({count: 2});
            await settle();

            // The window is still open on the fake clock: nothing extra is written.
            expect(storage.writtenKeys).toEqual(['slot']);

            clock.advance(60001);
            await settle();

            // The scheduled timer delivered the held-back state on its own.
            expect(storage.writtenKeys).toEqual(['slot', 'slot']);
            expect(JSON.parse(storage.getItem('slot') as string)).toEqual({count: 2});

            dispose();

            expect(storage.writtenKeys).toEqual(['slot', 'slot']);
        } finally {
            clock.restore();
        }
    });

    test('delivers a held-back partition write when the window elapses, without disposal', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({a: {n: 1}, b: {n: 1}});
        const clock = useFakeClock();

        try {
            const dispose = persist(store, {key: 'app', storage, partitions: ['a', 'b'], throttleMs: 60000});

            store.setData({a: {n: 2}, b: {n: 1}});
            await settle();

            expect(storage.writtenKeys).toEqual(['app.a', 'app.b']);

            storage.writtenKeys = [];
            store.setData({a: {n: 3}, b: {n: 1}});
            await settle();

            expect(storage.writtenKeys).toEqual([]);

            clock.advance(60001);
            await settle();

            // The timer delivered only the dirty branch; disposal adds nothing.
            expect(storage.writtenKeys).toEqual(['app.a']);
            expect(JSON.parse(storage.getItem('app.a') as string)).toEqual({n: 3});

            dispose();

            expect(storage.writtenKeys).toEqual(['app.a']);
        } finally {
            clock.restore();
        }
    });

    test('throttleMs requires the default coalescing and a non-negative number', () => {
        const storage = new MemoryStorage();
        expect(() => persist(new Carburetor({count: 0}), {
            key: 'slot', storage, throttleMs: 10, coalesce: false,
        })).toThrow();
        expect(() => persist(new Carburetor({count: 0}), {
            key: 'slot', storage, throttleMs: -1,
        })).toThrow();
    });
});
