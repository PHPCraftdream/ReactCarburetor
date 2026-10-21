import {Carburetor, IStorageLike, IPersistOptions, persist} from '@/Carburetor';

class Storage implements IStorageLike {
    public entries = new Map<string, string>();
    public reads: string[] = [];
    public writes: string[] = [];
    public removes: string[] = [];
    public getItem = (key: string): string | null => {
        this.reads.push(key);
        return this.entries.get(key) ?? null;
    };
    public setItem = (key: string, value: string): void => {
        this.writes.push(key);
        this.entries.set(key, value);
    };
    public removeItem = (key: string): void => {
        this.removes.push(key);
        this.entries.delete(key);
    };
}

const settle = (): Promise<void> => new Promise(resolve => queueMicrotask(resolve));
const options = (storage: Storage, extra: Partial<IPersistOptions> = {}): IPersistOptions => ({
    key: 'new', storage, ...extra,
});

describe('persist previous keys', () => {
    test('restores first found previous entry and immediately transfers it', () => {
        const storage = new Storage();
        storage.entries.set('good', JSON.stringify({count: 5}));
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {previousKeys: ['missing', 'good', 'later']}));
        expect(store.getData()).toEqual({count: 5});
        expect(storage.entries.has('good')).toBe(false);
        expect(JSON.parse(storage.entries.get('new') as string)).toEqual({count: 5});
        expect(storage.reads).toEqual(['new', 'missing', 'good']);
        expect(storage.writes).toEqual(['new']);
        expect(storage.removes).toEqual(['good']);
        dispose();
    });

    test('corrupt first found entry defaults and is retained, without trying later entries', () => {
        const storage = new Storage();
        storage.entries.set('bad', '{broken');
        storage.entries.set('good', JSON.stringify({count: 5}));
        const errors: unknown[] = [];
        const dispose = persist(new Carburetor({count: 0}), options(storage, {
            previousKeys: ['bad', 'good'], onError: error => errors.push(error),
        }));
        expect(errors).toHaveLength(1);
        expect(storage.entries.has('bad')).toBe(true);
        expect(storage.entries.has('good')).toBe(true);
        expect(storage.entries.has('new')).toBe(false);
        dispose();
    });

    test('corrupt fallback without onError defaults and remains after subsequent write', async () => {
        const storage = new Storage();
        storage.entries.set('old', '{broken');
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {previousKeys: ['old'], onError: () => undefined}));
        expect(store.getData()).toEqual({count: 0});
        expect(storage.entries.has('old')).toBe(true);
        store.setData({count: 1});
        await settle();
        expect(storage.entries.has('old')).toBe(true);
        dispose();
    });

    test('does not delete old data when immediate transfer write fails', () => {
        const entries = new Map([['old', JSON.stringify({count: 3})]]);
        const storage: IStorageLike = {
            getItem: key => entries.get(key) ?? null,
            setItem: () => { throw new Error('write'); },
            removeItem: key => { entries.delete(key); },
        };
        expect(() => persist(new Carburetor({count: 0}), {
            key: 'new', storage, previousKeys: ['old'],
        })).toThrow('write');
        expect(entries.has('old')).toBe(true);
    });

    test('current key prevents legacy reads', () => {
        const storage = new Storage();
        storage.entries.set('new', JSON.stringify({count: 2}));
        const dispose = persist(new Carburetor({count: 0}), options(storage, {previousKeys: ['old']}));
        expect(storage.reads).toEqual(['new']);
        dispose();
    });

    test('later writes do not read old keys when current key exists', async () => {
        const storage = new Storage();
        storage.entries.set('new', JSON.stringify({count: 2}));
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {previousKeys: ['old']}));
        store.setData({count: 3});
        await settle();
        expect(storage.reads).toEqual(['new']);
        dispose();
    });

    test('empty list is valid and names must be non-empty unique and not current', () => {
        persist(new Carburetor({count: 0}), options(new Storage(), {previousKeys: []}));
        const storage = new Storage();
        for (const previousKeys of [[''], ['x', 'x'], ['new']])
            expect(() => persist(new Carburetor({count: 0}), options(storage, {previousKeys}))).toThrow();
    });

    test('migrates previous raw state and writes a current-version envelope before deleting old', () => {
        const storage = new Storage();
        storage.entries.set('old', JSON.stringify({count: 7}));
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {
            previousKeys: ['old'], version: 1,
            migrate: {1: state => ({...(state as object), count: 8})},
        }));
        expect(store.getData()).toEqual({count: 8});
        expect(JSON.parse(storage.entries.get('new') as string)).toEqual({
            __carburetorVersion: 1, data: {count: 8},
        });
        expect(storage.entries.has('old')).toBe(false);
        dispose();
    });

    test('partition layout falls back only when current partitions and root are absent', () => {
        const storage = new Storage();
        storage.entries.set('old', JSON.stringify({a: 8, b: 9}));
        const store = new Carburetor({a: 0, b: 0});
        const dispose = persist(store, options(storage, {previousKeys: ['old'], partitions: ['a', 'b']}));
        expect(store.getData()).toEqual({a: 8, b: 9});
        expect(storage.entries.has('new')).toBe(true);
        expect(storage.entries.has('old')).toBe(false);
        dispose();
    });

    test('existing current partition prevents fallback to previous root', () => {
        const storage = new Storage();
        storage.entries.set('new.a', JSON.stringify(4));
        storage.entries.set('old', JSON.stringify({a: 8, b: 9}));
        const store = new Carburetor({a: 0, b: 0});
        const dispose = persist(store, options(storage, {
            previousKeys: ['old'], partitions: ['a', 'b'],
        }));
        expect(storage.reads).toEqual(['new.a', 'new.b']);
        expect(store.getData()).toEqual({a: 4, b: 0});
        expect(storage.entries.has('old')).toBe(true);
        dispose();
    });

    test('existing current root prevents fallback to previous root', () => {
        const storage = new Storage();
        storage.entries.set('new', JSON.stringify({a: 2, b: 3}));
        storage.entries.set('old', JSON.stringify({a: 8, b: 9}));
        const dispose = persist(new Carburetor({a: 0, b: 0}), options(storage, {
            previousKeys: ['old'], partitions: ['a', 'b'],
        }));
        expect(storage.reads).not.toContain('old');
        expect(storage.entries.has('old')).toBe(true);
        dispose();
    });

    test('malformed current partition blocks previous-root fallback', () => {
        const storage = new Storage();
        storage.entries.set('new.a', '{bad');
        storage.entries.set('old', JSON.stringify({a: 8, b: 9}));
        const dispose = persist(new Carburetor({a: 0, b: 0}), options(storage, {
            previousKeys: ['old'], partitions: ['a', 'b'], onError: () => undefined,
        }));
        expect(storage.reads).toEqual(['new.a', 'new.b', 'new']);
        expect(storage.entries.has('old')).toBe(true);
        dispose();
    });

    test('corrupt versioned current entry is retained and blocks writes', async () => {
        const storage = new Storage();
        storage.entries.set('new', '{broken');
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {
            version: 1, migrate: {1: state => state}, onError: () => undefined,
        }));
        expect(storage.entries.get('new')).toBe('{broken');
        store.setData({count: 1});
        await settle();
        expect(storage.entries.get('new')).toBe('{broken');
        dispose();
    });

    test('failed migration of a previous entry retains it and never transfers it', async () => {
        const storage = new Storage();
        storage.entries.set('old', JSON.stringify({count: 5}));
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {
            previousKeys: ['old'], version: 1,
            migrate: {1: () => { throw new Error('migration'); }}, onError: () => undefined,
        }));
        expect(storage.entries.has('old')).toBe(true);
        expect(storage.entries.has('new')).toBe(false);
        store.setData({count: 1});
        await settle();
        expect(storage.entries.has('old')).toBe(true);
        expect(storage.entries.has('new')).toBe(false);
        dispose();
    });

    test('coalesced writes remain coalesced and throttled disposal flushes', async () => {
        const storage = new Storage();
        const store = new Carburetor({count: 0});
        const dispose = persist(store, options(storage, {previousKeys: [], throttleMs: 60000}));
        store.setData({count: 1});
        await settle();
        expect(storage.writes).toEqual(['new']);
        store.setData({count: 2});
        await settle();
        expect(storage.writes).toEqual(['new']);
        dispose();
        expect(JSON.parse(storage.entries.get('new') as string)).toEqual({count: 2});
    });
});
