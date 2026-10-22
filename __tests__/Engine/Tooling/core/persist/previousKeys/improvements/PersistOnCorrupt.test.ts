import {Carburetor, IStorageLike, persist} from '@/Carburetor';

describe('persist onCorrupt', () => {
    test("onCorrupt 'reset' removes an unparseable entry under a function prune and keeps writing", () => {
        const errors: unknown[] = [];
        let removals = 0;
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: () => '{bad',
            removeItem: () => { removals++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            prune: (saved, _current, merge) => merge(saved),
            onCorrupt: 'reset',
            onError: error => { errors.push(error); },
        });

        expect(removals).toBe(1);
        expect(errors[0]).toBeInstanceOf(SyntaxError);
        expect(store.getData().count).toBe(0);
        store.setData({count: 1});
        expect(writes).toEqual([JSON.stringify({count: 1})]);
        dispose();
    });

    test("onCorrupt 'reset' removes an unparseable versioned entry and resumes versioned writes", () => {
        const errors: unknown[] = [];
        let removals = 0;
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: () => '{bad',
            removeItem: () => { removals++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            version: 1,
            migrate: {1: (state: unknown) => state},
            onCorrupt: 'reset',
            onError: error => { errors.push(error); },
        });

        expect(removals).toBe(1);
        expect(errors[0]).toBeInstanceOf(SyntaxError);
        store.setData({count: 1});
        expect(writes).toEqual([JSON.stringify({__carburetorVersion: 1, data: {count: 1}})]);
        dispose();
    });

    test("the default 'keep' policy blocks writing on an unparseable entry under a function prune", () => {
        const errors: unknown[] = [];
        let removals = 0;
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: () => '{bad',
            removeItem: () => { removals++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            prune: (saved, _current, merge) => merge(saved),
            onError: error => { errors.push(error); },
        });

        expect(removals).toBe(0);
        expect(errors[0]).toBeInstanceOf(SyntaxError);
        store.setData({count: 1});
        expect(writes).toEqual([]);
        dispose();
    });

    test("onCorrupt 'reset' removes an entry whose restore the store rejects and keeps writing", () => {
        const restoreError = new Error('bad restored state');
        const errors: unknown[] = [];
        let removals = 0;
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: () => JSON.stringify({count: 7}),
            removeItem: () => { removals++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        class RejectingStore extends Carburetor<{count: number}> {
            /** Rejects invalid restored data, retaining the current state. */
            public restore(): void { throw restoreError; }
        }
        const store = new RejectingStore({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            version: 1,
            migrate: {1: (state: unknown) => state},
            onCorrupt: 'reset',
            onError: error => { errors.push(error); },
        });

        expect(removals).toBe(1);
        expect(errors).toEqual([restoreError]);
        expect(store.getData().count).toBe(0);
        store.setData({count: 1});
        expect(writes).toEqual([JSON.stringify({__carburetorVersion: 1, data: {count: 1}})]);
        dispose();
    });

    test("the default 'keep' policy blocks writing when a restore the store rejects fails under version", () => {
        const restoreError = new Error('bad restored state');
        const errors: unknown[] = [];
        let removals = 0;
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: () => JSON.stringify({count: 7}),
            removeItem: () => { removals++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        class RejectingStore extends Carburetor<{count: number}> {
            /** Rejects invalid restored data, retaining the current state. */
            public restore(): void { throw restoreError; }
        }
        const store = new RejectingStore({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            version: 1,
            migrate: {1: (state: unknown) => state},
            onError: error => { errors.push(error); },
        });

        expect(removals).toBe(0);
        expect(errors).toEqual([restoreError]);
        store.setData({count: 1});
        expect(writes).toEqual([]);
        dispose();
    });

    test("onCorrupt 'reset' never removes a newer stored version", () => {
        const errors: unknown[] = [];
        let removals = 0;
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: () => JSON.stringify({__carburetorVersion: 99, data: {count: 5}}),
            removeItem: () => { removals++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            version: 1,
            migrate: {1: (state: unknown) => state},
            onCorrupt: 'reset',
            onError: error => { errors.push(error); },
        });

        expect(removals).toBe(0);
        expect(store.getData().count).toBe(0);
        store.setData({count: 1});
        expect(writes).toEqual([]);
        dispose();
    });

    test("onCorrupt 'reset' keeps the entry when a migration throws", () => {
        const migrationError = new Error('migration failed');
        const errors: unknown[] = [];
        let removals = 0;
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: () => JSON.stringify({__carburetorVersion: 1, data: {count: 5}}),
            removeItem: () => { removals++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            version: 1,
            migrate: {1: () => { throw migrationError; }},
            onCorrupt: 'reset',
            onError: error => { errors.push(error); },
        });

        expect(removals).toBe(0);
        expect(errors).toEqual([migrationError]);
        expect(store.getData().count).toBe(0);
        store.setData({count: 1});
        expect(writes).toEqual([]);
        dispose();
    });

    test("onCorrupt 'reset' keeps the entry when a prune callback throws", () => {
        const pruneError = new Error('prune failed');
        const errors: unknown[] = [];
        let removals = 0;
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: () => JSON.stringify({count: 5}),
            removeItem: () => { removals++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            prune: () => { throw pruneError; },
            onCorrupt: 'reset',
            onError: error => { errors.push(error); },
        });

        expect(removals).toBe(0);
        expect(errors).toEqual([pruneError]);
        expect(store.getData().count).toBe(0);
        store.setData({count: 1});
        expect(writes).toEqual([]);
        dispose();
    });

    test('an invalid onCorrupt value throws a RangeError', () => {
        const storage: IStorageLike = {
            getItem: () => null,
            removeItem: () => undefined,
            setItem: () => undefined,
        };
        const bad = 'purge' as 'reset';
        expect(() => persist(new Carburetor({count: 0}), {
            key: 'slot', storage, onCorrupt: bad,
        })).toThrow(RangeError);
    });

    test('onCorrupt cannot be combined with partitions', () => {
        const storage: IStorageLike = {
            getItem: () => null,
            removeItem: () => undefined,
            setItem: () => undefined,
        };
        expect(() => persist(new Carburetor({count: 0}), {
            key: 'slot', storage, partitions: ['count'], onCorrupt: 'keep',
        })).toThrow(/partitions/);
    });

    test("after a reset, a prune merge callback gets a fresh start", () => {
        const errors: unknown[] = [];
        let removals = 0;
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: () => '{bad',
            removeItem: () => { removals++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            prune: (saved, _current, merge) => merge(saved),
            onCorrupt: 'reset',
            onError: error => { errors.push(error); },
        });

        expect(removals).toBe(1);
        expect(errors[0]).toBeInstanceOf(SyntaxError);
        store.setData({count: 2});
        expect(writes).toEqual([JSON.stringify({count: 2})]);
        dispose();
    });

    test("onCorrupt 'reset' never removes a malformed fallback previousKeys source", () => {
        const errors: unknown[] = [];
        const removed: string[] = [];
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: name => (name === 'old' ? '{bad' : null),
            removeItem: name => { removed.push(name); },
            setItem: (_key, value) => { writes.push(value); },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            previousKeys: ['old'],
            onCorrupt: 'reset',
            onError: error => { errors.push(error); },
        });

        expect(removed).toEqual([]);
        expect(errors[0]).toBeInstanceOf(SyntaxError);
        store.setData({count: 1});
        expect(writes).toEqual([JSON.stringify({count: 1})]);
        dispose();
    });
});
