import {Carburetor, IStorageLike, persist} from '@/Carburetor';
import {flush} from '@/Testing';

class Storage implements IStorageLike {
    entries = new Map<string, string>();
    getItem = (key: string): string | null => this.entries.get(key) ?? null;
    setItem = (key: string, value: string): void => { this.entries.set(key, value); };
    removeItem = (key: string): void => { this.entries.delete(key); };
}
const settle = (): Promise<void> => new Promise(resolve => queueMicrotask(resolve));

class RejectA extends Carburetor<{a: number}> {
    restore(data: {a: number}): void {
        if (data.a < 0) throw Error('reject a');
        super.restore(data);
    }
}

describe('partition persistence error and retry paths', () => {
    test('reports partition reads and legacy reads, then continues with live values', () => {
        const errors: unknown[] = [];
        const storage = new Storage();
        storage.getItem = (key: string): string | null => {
            if (key === 'app.a' || key === 'app') throw Error(key);
            return null;
        };
        const store = new Carburetor({a: 1, b: 2});
        const stop = persist(store, {key: 'app', storage, partitions: ['a', 'b'], onError: e => errors.push(e)});
        expect(errors).toHaveLength(2);
        store.setData({a: 3, b: 2});
        return settle().then(() => {
            expect(JSON.parse(storage.entries.get('app.a') as string)).toBe(3);
            stop();
        });
    });

    test('keeps a bad partition retryable and removes a branch whose JSON value is undefined', async () => {
        const errors: unknown[] = [];
        const storage = new Storage();
        let fail = true;
        storage.setItem = (key, value) => {
            if (key === 'app.a' && fail) throw Error('quota');
            storage.entries.set(key, value);
        };
        const store = new Carburetor<{a?: number; b: number}>({a: 1, b: 1});
        const stop = persist(store, {key: 'app', storage, partitions: ['a', 'b'], onError: e => errors.push(e)});
        store.setData({a: 2, b: 1});
        await settle();
        fail = false;
        store.setData({a: 3, b: 1});
        await settle();
        expect(errors.length).toBeGreaterThan(0);
        expect(JSON.parse(storage.entries.get('app.a') as string)).toBe(3);
        store.setData({b: 1});
        await settle();
        expect(storage.entries.has('app.a')).toBe(false);
        stop();
    });

    test('reports malformed entry cleanup failures and preserves remaining branch', () => {
        const errors: unknown[] = [];
        const storage = new Storage();
        storage.entries.set('app.a', '{bad');
        storage.entries.set('app.b', '4');
        storage.removeItem = key => { if (key === 'app.a') throw Error('remove'); storage.entries.delete(key); };
        const store = new Carburetor({a: 1, b: 2});
        const stop = persist(store, {key: 'app', storage, partitions: ['a', 'b'], onError: e => errors.push(e)});
        expect(store.getData()).toEqual({a: 1, b: 4});
        expect(errors).toHaveLength(2);
        stop();
    });

    test('rethrows partition read failures without an error handler', () => {
        const storage = new Storage();
        storage.getItem = key => { throw Error('read ' + key); };
        expect(() => persist(new Carburetor({a: 1}), {key: 'app', storage, partitions: ['a']}))
            .toThrow('read app.a');
    });

    test('rethrows legacy read failures without an error handler', () => {
        const storage = new Storage();
        storage.getItem = key => { if (key === 'app.a') return null; throw Error('legacy read'); };
        expect(() => persist(new Carburetor({a: 1}), {key: 'app', storage, partitions: ['a']}))
            .toThrow('legacy read');
    });

    test('reports rejected single-partition restore and failed cleanup', () => {
        const storage = new Storage();
        const errors: unknown[] = [];
        storage.entries.set('app.a', '-1');
        storage.removeItem = () => { throw Error('cleanup'); };
        const stop = persist(new RejectA({a: 0}), {
            key: 'app', storage, partitions: ['a'], onError: error => errors.push(error),
        });
        expect(errors.map(e => (e as Error).message)).toEqual(['reject a', 'cleanup']);
        expect(storage.entries.get('app.a')).toBe('-1');
        stop();
    });

    test('reports legacy restore and removal failures while keeping defaults', () => {
        const storage = new Storage();
        const errors: unknown[] = [];
        storage.entries.set('app', JSON.stringify({a: -1}));
        storage.removeItem = () => { throw Error('cleanup legacy'); };
        const stop = persist(new RejectA({a: 0}), {
            key: 'app', storage, partitions: ['a'], onError: error => errors.push(error),
        });
        expect(errors.map(e => (e as Error).message)).toEqual(['reject a', 'cleanup legacy']);
        expect(storage.entries.has('app')).toBe(true);
        stop();
    });

    test('reports partition serialization errors and continues with other branches', async () => {
        const storage = new Storage();
        const errors: unknown[] = [];
        let shouldThrow = false;
        const store = new Carburetor({a: 1, b: 1});
        const original = store.toJSON.bind(store);
        store.toJSON = (() => {
            if (shouldThrow) throw Error('serialize');
            return original();
        }) as typeof store.toJSON;
        const stop = persist(store, {key: 'app', storage, partitions: ['a', 'b'], onError: e => errors.push(e)});
        shouldThrow = true;
        store.setData({a: 2, b: 1});
        await settle();
        expect(errors.map(e => (e as Error).message)).toEqual(['serialize', 'serialize']);
        expect(storage.entries.size).toBe(0);
        shouldThrow = false;
        store.setData({a: 3, b: 2});
        await settle();
        expect(storage.entries.get('app.a')).toBe('3');
        expect(storage.entries.get('app.b')).toBe('2');
        stop();
    });

    test('flush forces a pending throttled partition write', async () => {
        const storage = new Storage();
        const store = new Carburetor({a: 1, b: 1});
        const stop = persist(store, {key: 'app', storage, partitions: ['a', 'b'], throttleMs: 60_000});
        store.setData({a: 2, b: 1});
        await settle();
        expect(storage.entries.get('app.a')).toBe('2');
        store.setData({a: 3, b: 1});
        await settle();
        expect(storage.entries.get('app.a')).toBe('2');
        flush(store);
        expect(storage.entries.get('app.a')).toBe('3');
        expect(storage.entries.get('app.b')).toBe('1');
        stop();
    });
});
