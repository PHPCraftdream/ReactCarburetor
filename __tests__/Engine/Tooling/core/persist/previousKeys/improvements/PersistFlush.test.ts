import {Carburetor, CarburetorScope, ComponentUpdateThrottle, IStorageLike, carburetorToken, persist} from '@/Carburetor';
import {flush} from '@/Testing';

class MemoryStorage implements IStorageLike {
    public entries = new Map<string, string>();
    public writes = 0;

    public getItem(key: string): string | null { return this.entries.get(key) ?? null; }
    public setItem(key: string, value: string): void {
        this.writes++;
        this.entries.set(key, value);
    }
    public removeItem(key: string): void { this.entries.delete(key); }
}

const read = (storage: MemoryStorage, key: string): unknown => JSON.parse(storage.getItem(key) as string);

describe('persist synchronous testing flush', () => {
    test('flush(store) commits default-coalesced storage before returning', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        const dispose = persist(store, {key: 'value', storage});

        store.setData({value: 1});
        expect(storage.getItem('value')).toBeNull();
        flush(store);
        expect(read(storage, 'value')).toEqual({value: 1});
        dispose();
    });

    test('flush(store) forces a throttled write inside its established window', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0}, new ComponentUpdateThrottle(60_000));
        const dispose = persist(store, {key: 'value', storage, throttleMs: 60_000});

        store.setData({value: 1});
        flush(store);
        expect(read(storage, 'value')).toEqual({value: 1});
        store.setData({value: 2});
        flush(store);
        expect(read(storage, 'value')).toEqual({value: 2});
        dispose();
    });

    test('flush(store) commits default partitions synchronously', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({a: {value: 0}, b: {value: 0}});
        const dispose = persist(store, {key: 'app', storage, partitions: ['a', 'b']});

        store.setData({a: {value: 1}, b: {value: 2}});
        flush(store);
        expect(read(storage, 'app.a')).toEqual({value: 1});
        expect(read(storage, 'app.b')).toEqual({value: 2});
        dispose();
    });

    test('flush(store) commits throttled partitions synchronously', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({a: {value: 0}, b: {value: 0}});
        const dispose = persist(store, {
            key: 'app', storage, partitions: ['a', 'b'], throttleMs: 60_000,
        });

        store.setData({a: {value: 1}, b: {value: 2}});
        flush(store);
        expect(read(storage, 'app.a')).toEqual({value: 1});
        expect(read(storage, 'app.b')).toEqual({value: 2});
        store.setData({a: {value: 3}, b: {value: 4}});
        flush(store);
        expect(read(storage, 'app.a')).toEqual({value: 3});
        expect(read(storage, 'app.b')).toEqual({value: 4});
        dispose();
    });

    test('flush(scope) drains persistence for its owned store', () => {
        const storage = new MemoryStorage();
        const token = carburetorToken(() => new Carburetor({value: 0}), 'flush-persist-owned');
        const scope = new CarburetorScope();
        const child = scope.child([token]);
        const store = child.get(token);
        const dispose = persist(store, {key: 'owned', storage});

        store.setData({value: 4});
        flush(scope);
        expect(read(storage, 'owned')).toEqual({value: 4});
        dispose();
        scope.dispose();
    });

    test('dispose unregisters the drain and later writes do not persist', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        const dispose = persist(store, {key: 'value', storage});

        store.setData({value: 1});
        dispose();
        expect(read(storage, 'value')).toEqual({value: 1});
        const writes = storage.writes;
        store.setData({value: 2});
        flush(store);
        expect(storage.writes).toBe(writes);
        expect(read(storage, 'value')).toEqual({value: 1});
    });

    test('flush drains multiple persistence subscribers on one store', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({value: 0});
        const disposeA = persist(store, {key: 'first', storage});
        const disposeB = persist(store, {key: 'second', storage});

        store.setData({value: 3});
        flush(store);
        expect(read(storage, 'first')).toEqual({value: 3});
        expect(read(storage, 'second')).toEqual({value: 3});
        disposeA();
        disposeB();
    });

    test('flush without persistence is harmless and coalesce:false remains synchronous', () => {
        const storage = new MemoryStorage();
        const plain = new Carburetor({value: 0});
        plain.setData({value: 1});
        expect(() => flush(plain)).not.toThrow();
        expect(storage.writes).toBe(0);

        const store = new Carburetor({value: 0});
        const dispose = persist(store, {key: 'immediate', storage, coalesce: false});
        store.setData({value: 2});
        expect(read(storage, 'immediate')).toEqual({value: 2});
        dispose();
    });
});
