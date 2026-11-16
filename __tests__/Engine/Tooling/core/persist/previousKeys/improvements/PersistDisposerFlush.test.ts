import {Carburetor, ComponentUpdateThrottle, IStorageLike, persist} from '@/Carburetor';
import {createTestClock, flush} from '@/Testing';

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

describe('persist disposer flush()', () => {
    test('writes a held-back state at once; the window restarts and mirroring goes on', async () => {
        const clock = createTestClock();
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        clock.attach(store);
        const stop = persist(store, {key: 'v', storage, throttleMs: 100});

        store.setData({value: 1});
        await tick();
        store.setData({value: 2});
        await tick();
        expect(clock.pending).toBe(1);
        stop.flush();
        expect(read(storage, 'v')).toEqual({value: 2});
        expect(clock.pending).toBe(0);

        store.setData({value: 3});
        await tick();
        clock.advance(99);
        expect(read(storage, 'v')).toEqual({value: 2});
        clock.advance(1);
        expect(read(storage, 'v')).toEqual({value: 3});
        stop();
    });

    test('writes a change still in its coalescing microtask, and the microtask then writes nothing', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        const stop = persist(store, {key: 'v', storage});

        store.setData({value: 1});
        stop.flush();
        expect(read(storage, 'v')).toEqual({value: 1});
        await tick();
        expect(storage.writes).toBe(1);
        stop();
    });

    test('a notification delivered after flush() writes nothing more', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0}, new ComponentUpdateThrottle(60_000));
        const stop = persist(store, {key: 'v', storage});

        store.setData({value: 1});
        stop.flush();
        expect(read(storage, 'v')).toEqual({value: 1});
        flush(store);
        expect(storage.writes).toBe(1);
        stop();
    });

    test('with coalesce false it writes undelivered drift only', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0}, new ComponentUpdateThrottle(60_000));
        const stop = persist(store, {key: 'v', storage, coalesce: false});

        stop.flush();
        expect(storage.writes).toBe(0);
        store.setData({value: 1});
        stop.flush();
        expect(read(storage, 'v')).toEqual({value: 1});
        stop.flush();
        expect(storage.writes).toBe(1);
        stop();
    });

    test('without changes it writes nothing', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        const stop = persist(store, {key: 'v', storage});

        stop.flush();
        store.setData({value: 1});
        await tick();
        const writes = storage.writes;
        stop.flush();
        expect(storage.writes).toBe(writes);
        stop();
    });

    test('does nothing after the disposer or the store disposal', () => {
        const storage = new MemoryStorage();
        const first = new Carburetor({value: 0});
        const stopFirst = persist(first, {key: 'a', storage});
        stopFirst();
        first.setData({value: 1});
        stopFirst.flush();

        const second = new Carburetor({value: 0});
        const stopSecond = persist(second, {key: 'b', storage});
        second.dispose();
        stopSecond.flush();

        expect(storage.writes).toBe(0);
    });

    test('a failed write goes to onError and is not retried for the same version', () => {
        const storage = new MemoryStorage();
        const errors: unknown[] = [];
        const store = new Carburetor({value: 0});
        const stop = persist(store, {key: 'v', storage, onError: (error) => errors.push(error)});

        store.setData({value: 1});
        storage.failing = true;
        expect(() => stop.flush()).not.toThrow();
        stop.flush();
        expect(errors).toHaveLength(1);
        stop();
    });

    test('writes nothing while a newer stored version blocks the subscription', () => {
        const storage = new MemoryStorage();
        storage.entries.set('v', '{"__carburetorVersion":9,"data":{"x":1}}');
        const store = new Carburetor({x: 0});
        const stop = persist(store, {
            key: 'v', storage, version: 2, migrate: {1: (x) => x, 2: (x) => x}, onError: () => undefined,
        });

        store.setData({x: 2});
        stop.flush();
        expect(storage.writes).toBe(0);
        stop();
    });

    test('works as an event listener, whatever it is called with', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        const stop = persist(store, {key: 'v', storage});
        const target = new EventTarget();
        target.addEventListener('pagehide', stop.flush);

        store.setData({value: 1});
        target.dispatchEvent(new Event('pagehide'));
        expect(read(storage, 'v')).toEqual({value: 1});
        target.removeEventListener('pagehide', stop.flush);
        stop();
    });

    test('partitions write only the changed branches and retry a failed one', async () => {
        const storage = new MemoryStorage();
        const errors: unknown[] = [];
        const store = new Carburetor({a: {n: 0}, b: {n: 0}});
        const stop = persist(store, {
            key: 'app', storage, throttleMs: 60_000, partitions: ['a', 'b'],
            onError: (error) => errors.push(error),
        });

        store.setData({a: {n: 1}, b: {n: 0}});
        await tick();
        const sealed = storage.writes;
        store.setData({a: {n: 2}, b: {n: 0}});
        storage.failing = true;
        stop.flush();
        expect(errors).toHaveLength(1);
        storage.failing = false;
        store.setData({a: {n: 2}, b: {n: 3}});
        stop.flush();
        expect(storage.writes).toBe(sealed + 2);
        expect(read(storage, 'app.a')).toEqual({n: 2});
        expect(read(storage, 'app.b')).toEqual({n: 3});
        stop.flush();
        expect(storage.writes).toBe(sealed + 2);
        stop();
    });
});
