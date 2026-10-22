import {Carburetor, IStorageLike, IPersistOptions, persist} from '@/Carburetor';

class Storage implements IStorageLike {
    public value: string | null = null;
    public getItem = (): string | null => this.value;
    public setItem = (_key: string, value: string): void => { this.value = value; };
    public removeItem = (): void => { this.value = null; };
}

const options = (storage: Storage, extra: Partial<IPersistOptions> = {}): IPersistOptions => ({
    key: 'state', storage, coalesce: false, ...extra,
});

describe('persist prune merge callback', () => {
    test('callback sees raw saved data and opts into default merging and pruning', () => {
        const storage = new Storage();
        storage.value = JSON.stringify({kept: 2, stale: true});
        const store = new Carburetor({kept: 0, added: 3});
        let seen: unknown;
        const stop = persist(store, options(storage, {
            prune: (saved, current, merge) => {
                seen = JSON.parse(JSON.stringify([saved, current]));
                return merge(saved);
            },
        }));
        expect(seen).toEqual([{kept: 2, stale: true}, {kept: 0, added: 3}]);
        expect(store.getData()).toEqual({kept: 2, added: 3});
        stop();
    });

    test('migration runs before the callback', () => {
        const storage = new Storage();
        storage.value = JSON.stringify({__carburetorVersion: 1, data: {count: 2}});
        const store = new Carburetor({count: 0});
        const stop = persist(store, options(storage, {
            version: 2,
            migrate: {1: state => state, 2: state => ({count: (state as {count: number}).count + 1})},
            prune: saved => {
                expect(saved).toEqual({count: 3});
                return saved;
            },
        }));
        expect(store.getData()).toEqual({count: 3});
        stop();
    });

    test('with a version the callback result is still composed over defaults, as before', () => {
        const storage = new Storage();
        storage.value = JSON.stringify({kept: 2, stale: true});
        const store = new Carburetor({kept: 0, added: 3});
        const result = {own: true};
        const stop = persist(store, options(storage, {
            version: 0, migrate: {}, prune: saved => {
                expect(saved).toEqual({kept: 2, stale: true});
                return result;
            },
        }));
        expect(store.getData()).toEqual({kept: 0, added: 3, own: true});
        stop();
    });

    test('callback failure keeps stored bytes and blocks writes', () => {
        const failure = new Error('prune failed');
        const storage = new Storage();
        storage.value = '{"kept":2}';
        const original = storage.value;
        expect(() => persist(new Carburetor({kept: 0}), options(storage, {
            prune: () => { throw failure; },
        }))).toThrow(failure);
        expect(storage.value).toBe(original);
        const errors: unknown[] = [];
        const store = new Carburetor({kept: 0});
        const stop = persist(store, options(storage, {
            prune: () => { throw failure; }, onError: error => errors.push(error),
        }));
        store.setData({kept: 5});
        stop();
        expect(errors).toEqual([failure]);
        expect(storage.value).toBe(original);
    });
});
