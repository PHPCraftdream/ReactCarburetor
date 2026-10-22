import {Carburetor, IStorageLike, IPersistOptions, persist} from '@/Carburetor';

class Storage implements IStorageLike {
    public entries = new Map<string, string>();
    public writes: string[] = [];
    public failures = 0;
    public getItem = (key: string): string | null => this.entries.get(key) ?? null;
    public setItem = (key: string, value: string): void => {
        if (this.failures > 0) {
            this.failures--;
            throw new Error('quota exceeded');
        }
        this.writes.push(value);
        this.entries.set(key, value);
    };
    public removeItem = (key: string): void => { this.entries.delete(key); };
}

const options = (storage: Storage, extra: Partial<IPersistOptions> = {}): IPersistOptions<{count: number}> => ({
    key: 'slot', storage, ...extra,
});
const settle = (): Promise<void> => new Promise(resolve => queueMicrotask(resolve));

describe('persist writeAfterRestore', () => {
    test('prune: true writes the normalized state at connect', () => {
        const storage = new Storage();
        storage.entries.set('slot', JSON.stringify({count: 2, stale: true}));
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {prune: true, coalesce: false}));
        expect(store.getData()).toEqual({count: 2});
        expect(storage.writes).toEqual([JSON.stringify({count: 2})]);
        dispose();
    });

    test('a function prune filling defaults writes at connect', () => {
        const storage = new Storage();
        storage.entries.set('slot', JSON.stringify({count: 4}));
        const store = new Carburetor({count: 0, added: 9});
        const dispose = persist(store, options(storage, {
            prune: (saved, _current, merge) => merge(saved), coalesce: false,
        }));
        expect(store.getData()).toEqual({count: 4, added: 9});
        expect(storage.writes).toEqual([JSON.stringify({count: 4, added: 9})]);
        dispose();
    });

    test('a migration writes the versioned envelope at connect', () => {
        const storage = new Storage();
        storage.entries.set('slot', JSON.stringify({count: 2}));
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {
            version: 1, migrate: {1: () => ({count: 3})},
        }));
        expect(store.getData()).toEqual({count: 3});
        expect(storage.writes).toEqual([JSON.stringify({__carburetorVersion: 1, data: {count: 3}})]);
        expect(storage.entries.get('slot')).toContain('__carburetorVersion');
        dispose();
    });

    test('the default writes nothing when the serialization equals the stored text', () => {
        const stored = JSON.stringify({count: 7});
        const storage = new Storage();
        storage.entries.set('slot', stored);
        const dispose = persist(new Carburetor({count: 0}), options(storage, {coalesce: false}));
        expect(storage.writes).toEqual([]);
        dispose();
        expect(storage.entries.get('slot')).toBe(stored);
    });

    test("'always' writes even when equal and 'never' never writes", () => {
        const stored = JSON.stringify({count: 7});
        const storage = new Storage();
        storage.entries.set('slot', stored);
        const disposeAlways = persist(new Carburetor({count: 0}), options(storage, {
            writeAfterRestore: 'always', coalesce: false,
        }));
        expect(storage.writes).toEqual([stored]);
        disposeAlways();

        storage.writes.length = 0;
        const disposeNever = persist(new Carburetor({count: 0}), options(storage, {
            writeAfterRestore: 'never', coalesce: false,
        }));
        expect(storage.writes).toEqual([]);
        disposeNever();
    });

    test('the connect write does not move the throttle window', async () => {
        const storage = new Storage();
        storage.entries.set('slot', JSON.stringify({count: 2, stale: true}));
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {prune: true, throttleMs: 60000}));
        expect(storage.writes).toHaveLength(1);
        store.setData({count: 5});
        await settle();
        expect(storage.writes).toHaveLength(2);
        expect(JSON.parse(storage.writes[1])).toEqual({count: 5});
        dispose();
    });

    test('a blocked subscription (newer stored version) writes nothing at connect', () => {
        const original = '{"__carburetorVersion":9,"data":{"count":1}}';
        const storage = new Storage();
        storage.entries.set('slot', original);
        const errors: unknown[] = [];
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {
            version: 2, migrate: {1: state => state, 2: state => state},
            onError: error => errors.push(error),
        }));
        expect(store.getData()).toEqual({count: 0});
        expect(storage.writes).toEqual([]);
        expect(errors).toHaveLength(1);
        dispose();
        expect(storage.entries.get('slot')).toBe(original);
    });

    test('a failing setItem at connect reaches onError and the subscription keeps working', async () => {
        const storage = new Storage();
        storage.entries.set('slot', JSON.stringify({count: 2, stale: true}));
        storage.failures = 1;
        const errors: unknown[] = [];
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {
            prune: true, coalesce: false, onError: error => errors.push(error),
        }));
        expect((errors[0] as Error).message).toBe('quota exceeded');
        store.setData({count: 6});
        expect(JSON.parse(storage.entries.get('slot') as string)).toEqual({count: 6});
        dispose();
    });

    test('a previousKeys transfer writes the new key exactly once', () => {
        const storage = new Storage();
        storage.entries.set('old', JSON.stringify({count: 5}));
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {previousKeys: ['old'], coalesce: false}));
        expect(store.getData()).toEqual({count: 5});
        expect(storage.writes).toEqual([JSON.stringify({count: 5})]);
        dispose();
    });

    test('writeAfterRestore cannot be combined with partitions', () => {
        const storage = new Storage();
        expect(() => persist(new Carburetor({count: 0}), options(storage, {
            partitions: ['count'], writeAfterRestore: 'changed',
        }))).toThrow(/partitions/);
    });

    test('an invalid writeAfterRestore value throws a RangeError', () => {
        const storage = new Storage();
        const bad = 'sometimes' as 'changed';
        expect(() => persist(new Carburetor({count: 0}), options(storage, {writeAfterRestore: bad})))
            .toThrow(RangeError);
    });

    test('nothing stored means no write at connect', async () => {
        const storage = new Storage();
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {writeAfterRestore: 'always'}));
        expect(storage.writes).toEqual([]);
        store.setData({count: 1});
        await settle();
        expect(storage.writes).toEqual([JSON.stringify({count: 1})]);
        dispose();
    });
});
