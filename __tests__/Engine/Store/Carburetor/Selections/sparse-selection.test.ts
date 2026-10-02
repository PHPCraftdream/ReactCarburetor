import {Carburetor} from '@/Carburetor';

interface ISparseData {
    marker: number;
    useRight: boolean;
    left: unknown[];
    right: unknown[];
}

const sparseRows = (): unknown[] => {
    const rows: unknown[] = [];
    rows.length = 65_536;
    rows[0] = 1;
    rows[65_535] = 9;

    return rows;
};

describe('sparse selected arrays through public watch (R31-03)', () => {
    test('same-content wakes suppress; adding or deleting an undefined-valued slot is visible', () => {
        const rows = sparseRows();
        const right = sparseRows();
        const store = new Carburetor<ISparseData>({marker: 0, useRight: false, left: rows, right});
        const seen: Array<{parity: number; length: number; hasSeven: boolean; value: unknown}> = [];
        const stop = store.watch(data => ({parity: data.marker % 2, rows: data.left}), next => {
            seen.push({
                parity: next.parity,
                length: next.rows.length,
                hasSeven: Object.prototype.hasOwnProperty.call(next.rows, 7),
                value: next.rows[7],
            });
        });

        // Wake and renew tracking without changing the selected content.
        store.setData({marker: 2, useRight: false, left: sparseRows(), right});
        expect(seen).toEqual([]);

        const withUndefined = sparseRows();
        withUndefined[7] = undefined;
        store.setData({marker: 2, useRight: false, left: withUndefined, right});
        expect(seen).toEqual([{parity: 0, length: 65_536, hasSeven: true, value: undefined}]);

        store.setData({marker: 2, useRight: false, left: sparseRows(), right});
        expect(seen).toEqual([
            {parity: 0, length: 65_536, hasSeven: true, value: undefined},
            {parity: 0, length: 65_536, hasSeven: false, value: undefined},
        ]);

        stop();
    });

    test('a changed selector branch follows only the currently selected sparse array', () => {
        const left = sparseRows();
        const right = sparseRows();
        const store = new Carburetor<ISparseData>({marker: 0, useRight: false, left, right});
        const seen: Array<{branch: string; present: boolean}> = [];
        const stop = store.watch(data => ({
            branch: data.useRight ? 'right' : 'left',
            rows: data.useRight ? data.right : data.left,
        }), next => {
            seen.push({
                branch: next.branch,
                present: Object.prototype.hasOwnProperty.call(next.rows, 7),
            });
        });

        store.setData({marker: 0, useRight: true, left, right});
        expect(seen).toEqual([{branch: 'right', present: false}]);

        const changedLeft = sparseRows();
        changedLeft[7] = 4;
        store.setData({marker: 0, useRight: true, left: changedLeft, right});
        expect(seen).toEqual([{branch: 'right', present: false}]);

        const changedRight = sparseRows();
        changedRight[7] = 5;
        store.setData({marker: 0, useRight: true, left: changedLeft, right: changedRight});
        expect(seen).toEqual([
            {branch: 'right', present: false},
            {branch: 'right', present: true},
        ]);

        stop();
    });

    test('detached sparse arrays retain length, prototype, holes, non-enumerable indices and cycles', () => {
        const rows: unknown[] = [];
        rows.length = 16;
        Object.setPrototypeOf(rows, null);
        Object.defineProperty(rows, '5', {value: 5, writable: true, configurable: true, enumerable: false});
        rows[10] = rows;
        const store = new Carburetor<{marker: number}>({marker: 0});
        const seen: unknown[][] = [];
        const stop = store.watch(data => ({marker: data.marker, rows}), next => {
            seen.push(next.rows);
        });

        store.setData({marker: 1});

        expect(seen).toHaveLength(1);
        expect(seen[0].length).toBe(16);
        expect(Object.getPrototypeOf(seen[0])).toBe(null);
        expect(Object.prototype.hasOwnProperty.call(seen[0], 5)).toBe(true);
        expect(seen[0][5]).toBe(5);
        expect(Object.prototype.hasOwnProperty.call(seen[0], 6)).toBe(false);
        expect(seen[0][10]).toBe(seen[0]);

        stop();
    });
});
