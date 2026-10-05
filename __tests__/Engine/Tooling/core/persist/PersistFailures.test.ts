import {Carburetor, IStorageLike, persist} from '@/Carburetor';

describe('persist storage failures', () => {
    test.each([false, true])('failed reads preserve unread data and report errors (coalesce=%s)', async coalesce => {
        const readError = new Error('storage unavailable');
        const errors: unknown[] = [];
        let reads = 0;
        let removals = 0;
        const writes: string[] = [];
        const storage: IStorageLike = {
            getItem: () => {
                reads++;
                throw readError;
            },
            removeItem: () => { removals++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {key: 'slot', storage, coalesce, onError: error => { errors.push(error); }});

        expect(errors).toEqual([readError]);
        expect(reads).toBe(1);
        expect(removals).toBe(0);
        expect(writes).toEqual([]);
        store.setData({count: 1});
        if (coalesce) {
            expect(writes).toEqual([]);
            await new Promise<void>(resolve => queueMicrotask(resolve));
        }
        expect(writes).toEqual([JSON.stringify({count: 1})]);
        dispose();
        store.setData({count: 2});
        await new Promise<void>(resolve => queueMicrotask(resolve));
        expect(writes).toEqual([JSON.stringify({count: 1})]);
    });

    test('a malformed entry reports its original parse error before a separate failed removal', () => {
        const removeError = new Error('cannot remove');
        const errors: unknown[] = [];
        const writes: string[] = [];
        const stored = '{bad json';
        const storage: IStorageLike = {
            getItem: () => stored,
            removeItem: () => {
                expect(errors[0]).toBeInstanceOf(SyntaxError);
                throw removeError;
            },
            setItem: (_key, value) => { writes.push(value); },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            onError: error => { errors.push(error); },
        });

        expect(errors).toHaveLength(2);
        expect(errors[0]).toBeInstanceOf(SyntaxError);
        expect(errors[1]).toBe(removeError);
        expect(store.getData().count).toBe(0);
        expect(writes).toEqual([]);
        store.setData({count: 2});
        expect(writes).toEqual([JSON.stringify({count: 2})]);
        dispose();
        store.setData({count: 3});
        expect(writes).toHaveLength(1);
    });

    test('a restore failure is reported before cleanup and a successful read does not write initially', () => {
        const restoreError = new Error('bad restored state');
        const errors: unknown[] = [];
        const writes: string[] = [];
        let removed = 0;
        const storage: IStorageLike = {
            getItem: () => JSON.stringify({count: 7}),
            removeItem: () => { removed++; },
            setItem: (_key, value) => { writes.push(value); },
        };
        class RejectingStore extends Carburetor<{count: number}> {
            /** Rejects invalid restored data, retaining the current state. */
            public restore(): void { throw restoreError; }
        }
        const rejecting = new RejectingStore({count: 0});
        const stopRejecting = persist(rejecting, {
            key: 'slot',
            storage,
            coalesce: false,
            onError: error => { errors.push(error); },
        });
        expect(errors).toEqual([restoreError]);
        expect(removed).toBe(1);
        expect(writes).toEqual([]);
        stopRejecting();

        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            onError: error => { errors.push(error); },
        });
        expect(store.getData().count).toBe(7);
        expect(writes).toEqual([]);
        expect(errors).toEqual([restoreError]);
        store.setData({count: 8});
        expect(writes).toEqual([JSON.stringify({count: 8})]);
        dispose();
        store.setData({count: 9});
        expect(writes).toHaveLength(1);
    });

    test('a synchronous failing write reports its cause while later subscribers still run', () => {
        const writeError = new Error('quota');
        const errors: unknown[] = [];
        let writes = 0;
        let downstream = 0;
        const storage: IStorageLike = {
            getItem: () => null,
            removeItem: () => undefined,
            setItem: () => { writes++; throw writeError; },
        };
        const store = new Carburetor({count: 0});
        const dispose = persist(store, {
            key: 'slot',
            storage,
            coalesce: false,
            onError: error => { errors.push(error); },
        });
        const downstreamId = store.subscribe(() => { downstream++; });
        store.setData({count: 1});
        expect(errors).toEqual([writeError]);
        expect(writes).toBe(1);
        expect(downstream).toBe(1);
        dispose();
        store.setData({count: 2});
        expect(writes).toBe(1);
        store.unsubscribe(downstreamId);
    });

    test('onError exceptions escape intact rather than being caught as storage failures', () => {
        const userError = new Error('handler failed');
        const reading: IStorageLike = {
            getItem: () => { throw new Error('read'); },
            removeItem: () => undefined,
            setItem: () => undefined,
        };
        expect(() => persist(new Carburetor({count: 0}), {
            key: 'slot', storage: reading, onError: () => { throw userError; },
        })).toThrow(userError);

        const badData: IStorageLike = {...reading, getItem: () => '{broken'};
        expect(() => persist(new Carburetor({count: 0}), {
            key: 'slot', storage: badData, onError: () => { throw userError; },
        })).toThrow(userError);
        expect(() => persist(new Carburetor({count: 0}), {key: 'slot', storage: reading})).toThrow('read');
    });
});
