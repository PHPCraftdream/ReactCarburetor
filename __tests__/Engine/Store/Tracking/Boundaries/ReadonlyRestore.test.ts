import {Carburetor} from '@/Carburetor';

describe('accepted readonly state restore boundaries', () => {
    test('edited snapshot replaces a readonly value atomically after an earlier sibling', () => {
        const state = {first: 1, row: {n: 2}};
        Object.defineProperty(state.row, 'n', {
            value: 2, writable: false, enumerable: true, configurable: true,
        });
        const store = new Carburetor(state);
        const snapshot = store.snapshot();
        expect(Object.getOwnPropertyDescriptor(snapshot.row, 'n')?.writable).toBe(true);
        snapshot.first = 3;
        snapshot.row.n = 4;
        const seen: number[] = [];
        const stop = store.watch(data => data.row.n, n => { seen.push(n); });
        store.restore(snapshot);
        expect(store.getData()).not.toBe(snapshot);
        expect(store.getData().first).toBe(3);
        expect(store.getData().row.n).toBe(4);
        expect(seen).toEqual([4]);
        expect(store.getVersion()).toBe(1);
        snapshot.row.n = 99;
        expect(store.getData().row.n).toBe(4);
        stop();
    });

    test('preflights a locked array tail before writing an earlier sibling', () => {
        const state = {first: 1, rows: [1, 2, 3]};
        Object.defineProperty(state.rows, '2', {
            value: 3, writable: true, enumerable: true, configurable: false,
        });
        const store = new Carburetor(state);
        const snapshot = store.snapshot();
        snapshot.first = 2;
        snapshot.rows.length = 1;
        store.restore(snapshot);
        expect(state.first).toBe(1);
        expect(state.rows.length).toBe(3);
        expect(store.getData().first).toBe(2);
        expect(store.getData().rows).toEqual([1]);
        expect(store.getVersion()).toBe(1);
    });
});
