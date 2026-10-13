import {Carburetor} from '@/Carburetor';

describe('sparse selections stay O(own keys) under reconcile (R34-02)', () => {
    test('a 65 536-slot sparse array costs a handful of index probes, not one per slot', () => {
        const rows: unknown[] = [];
        rows.length = 65536;
        rows[0] = 1;
        rows[65535] = 2;
        const store = new Carburetor<{marker: number; rows: unknown[]}>({marker: 0, rows});
        let notifications = 0;
        let selected: {parity: number; rows: unknown[]} | undefined;
        const stop = store.watch(view => ({parity: view.marker % 2, rows: view.rows}), value => {
            notifications++;
            selected = value;
        });
        const hasOwn = Object.prototype.hasOwnProperty;
        let indexChecks = 0;

        Object.prototype.hasOwnProperty = function (this: object, key: PropertyKey): boolean {
            if (Array.isArray(this) && typeof key === 'number') indexChecks++;

            return hasOwn.call(this, key);
        };

        try {
            store.setData({marker: 2, rows});
        } finally {
            Object.prototype.hasOwnProperty = hasOwn;
        }

        const next = rows.slice();
        next[7] = undefined;
        store.setData({marker: 2, rows: next});
        stop();

        expect(indexChecks).toBeLessThanOrEqual(16);
        expect(notifications).toBe(1);
        expect(selected?.rows.length).toBe(65536);
        expect(Object.hasOwn(selected!.rows, 7)).toBe(true);
        expect(8 in selected!.rows).toBe(false);
    });
});
