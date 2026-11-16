import {Carburetor, ComponentUpdateThrottle, IStorageLike, persist, transaction} from '@/Carburetor';
import {createTestClock} from '@/Testing';

class MemoryStorage implements IStorageLike {
    public entries = new Map<string, string>();
    public writes = 0;
    public failing = false;

    public getItem(key: string): string | null { return this.entries.get(key) ?? null; }
    public setItem(key: string, value: string): void {
        if (this.failing) throw new Error('quota');
        this.writes++;
        this.entries.set(key, value);
    }
    public removeItem(key: string): void { this.entries.delete(key); }
}

const read = (storage: MemoryStorage, key: string): unknown => JSON.parse(storage.getItem(key) as string);
const tick = (): Promise<void> => Promise.resolve();

describe('persist throttle on the store clock', () => {
    test('the window runs on an attached test clock', async () => {
        const clock = createTestClock();
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        clock.attach(store);
        const stop = persist(store, {key: 'v', storage, throttleMs: 100});

        store.setData({value: 1});
        await tick();
        expect(read(storage, 'v')).toEqual({value: 1});
        store.setData({value: 2});
        await tick();
        expect(clock.pending).toBe(1);
        clock.advance(99);
        expect(read(storage, 'v')).toEqual({value: 1});
        clock.advance(1);
        expect(read(storage, 'v')).toEqual({value: 2});
        expect(clock.pending).toBe(0);
        stop();
    });

    test('a window armed before the clock is attached moves onto it', async () => {
        const clock = createTestClock();
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        const stop = persist(store, {key: 'v', storage, throttleMs: 60_000});

        store.setData({value: 1});
        await tick();
        store.setData({value: 2});
        await tick();
        clock.attach(store);
        expect(clock.pending).toBe(1);
        clock.advance(60_000);
        expect(read(storage, 'v')).toEqual({value: 2});
        stop();
    });

    test('partitions write only the dirty branch when the clock opens the window', async () => {
        const clock = createTestClock();
        const storage = new MemoryStorage();
        const store = new Carburetor({a: {n: 0}, b: {n: 0}});
        clock.attach(store);
        const stop = persist(store, {key: 'app', storage, throttleMs: 50, partitions: ['a', 'b']});

        store.setData({a: {n: 1}, b: {n: 0}});
        await tick();
        const sealed = storage.writes;
        store.setData({a: {n: 1}, b: {n: 2}});
        await tick();
        clock.advance(50);
        expect(storage.writes).toBe(sealed + 1);
        expect(read(storage, 'app.b')).toEqual({n: 2});
        stop();
    });
});

describe('store disposal ends persist', () => {
    test('a held-back write lands synchronously and nothing is left to run', async () => {
        const clock = createTestClock();
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        clock.attach(store);
        const stop = persist(store, {key: 'v', storage, throttleMs: 1000});

        store.setData({value: 1});
        await tick();
        store.setData({value: 2});
        await tick();
        store.dispose();
        expect(read(storage, 'v')).toEqual({value: 2});
        expect(clock.pending).toBe(0);
        const writes = storage.writes;
        clock.advance(1000);
        stop();
        expect(storage.writes).toBe(writes);
    });

    test('a change still in its coalescing microtask is written at disposal', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        persist(store, {key: 'v', storage});

        store.setData({value: 1});
        store.dispose();
        expect(read(storage, 'v')).toEqual({value: 1});
    });

    test('disposal without pending changes writes nothing', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        persist(store, {key: 'v', storage});

        store.setData({value: 1});
        await tick();
        const writes = storage.writes;
        store.dispose();
        expect(storage.writes).toBe(writes);
    });

    test.each([true, false])('a notification cancelled by disposal is written (coalesce %s)', (coalesce) => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0}, new ComponentUpdateThrottle(40));
        persist(store, {key: 'v', storage, coalesce});

        store.setData({value: 1});
        store.dispose();
        expect(read(storage, 'v')).toEqual({value: 1});
    });

    test('a write inside a transaction that disposes the store is kept', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        persist(store, {key: 'v', storage});

        transaction(() => {
            store.setData({value: 1});
            store.dispose();
        });
        expect(read(storage, 'v')).toEqual({value: 1});
    });

    test('partitions reconcile every branch at disposal, a failed one included', async () => {
        const clock = createTestClock();
        const storage = new MemoryStorage();
        const errors: unknown[] = [];
        const store = new Carburetor({a: {n: 0}, b: {n: 0}});
        clock.attach(store);
        persist(store, {
            key: 'app', storage, throttleMs: 1000, partitions: ['a', 'b'],
            onError: (error) => errors.push(error),
        });

        store.setData({a: {n: 1}, b: {n: 0}});
        await tick();
        store.setData({a: {n: 2}, b: {n: 0}});
        await tick();
        storage.failing = true;
        clock.advance(1000);
        expect(errors).toHaveLength(1);
        storage.failing = false;
        store.setData({a: {n: 2}, b: {n: 3}});
        store.dispose();
        expect(read(storage, 'app.a')).toEqual({n: 2});
        expect(read(storage, 'app.b')).toEqual({n: 3});
        expect(clock.pending).toBe(0);
    });

    test('a failing write at disposal goes to onError and disposal completes', () => {
        const storage = new MemoryStorage();
        const errors: unknown[] = [];
        const store = new Carburetor({value: 0});
        persist(store, {key: 'v', storage, onError: (error) => errors.push(error)});

        store.setData({value: 1});
        storage.failing = true;
        expect(() => store.dispose()).not.toThrow();
        expect(errors).toHaveLength(1);
        expect(() => store.setData({value: 2})).toThrow('disposed');
    });

    test('a throwing onError surfaces from dispose after the rest of the cleanup ran', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        persist(store, {key: 'v', storage, onError: () => { throw new Error('reported'); }});
        const later = persist(store, {key: 'w', storage});

        store.setData({value: 1});
        storage.failing = true;
        expect(() => store.dispose()).toThrow('reported');
        storage.failing = false;
        later();
        expect(storage.getItem('w')).toBeNull();
        expect(() => store.setData({value: 2})).toThrow('disposed');
    });

    test('a microtask queued before disposal does not throw afterwards', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        persist(store, {key: 'v', storage, throttleMs: 1000});

        store.setData({value: 1});
        await tick();
        store.setData({value: 2});
        store.dispose();
        await tick();
        expect(read(storage, 'v')).toEqual({value: 2});
    });
});

describe('the persist disposer runs once', () => {
    test.each([
        ['coalesced', {}],
        ['synchronous', {coalesce: false}],
        ['partitioned', {partitions: ['a']}],
    ] as const)('a second call after a change writes nothing (%s)', (_name, extra) => {
        const storage = new MemoryStorage();
        const store = new Carburetor({a: {n: 0}});
        const stop = persist(store, {key: 'k', storage, ...extra});

        stop();
        const writes = storage.writes;
        store.setData({a: {n: 1}});
        stop();
        expect(storage.writes).toBe(writes);
    });

    test('the disposer after store disposal writes nothing more', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        const stop = persist(store, {key: 'v', storage});

        store.setData({value: 1});
        store.dispose();
        const writes = storage.writes;
        stop();
        expect(storage.writes).toBe(writes);
    });

    test('store disposal after the disposer writes nothing more', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        const stop = persist(store, {key: 'v', storage});

        store.setData({value: 1});
        stop();
        const writes = storage.writes;
        store.dispose();
        expect(storage.writes).toBe(writes);
    });
});
