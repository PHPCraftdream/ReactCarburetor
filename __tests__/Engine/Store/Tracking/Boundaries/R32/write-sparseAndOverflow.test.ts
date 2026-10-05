import {Carburetor} from "@/Carburetor";
import {diffPaths} from "@/Carburetor/Store/Paths/Diff/diffPaths";
import {rstest} from "@rstest/core";
import {types} from "node:util";

const withRows = (length: number, last: number): {rows: ({n: number} | undefined)[]} => {
    const rows: ({n: number} | undefined)[] = [];

    rows.length = length;
    rows[3] = {n: 1};
    rows[length - 1] = {n: last};

    return {rows};
};

describe('diffPaths on long sparse arrays (R32-05)', () => {
    test('walks the stored elements, not the length', () => {
        const probe = rstest.spyOn(Object.prototype, 'hasOwnProperty');
        const changed = diffPaths(withRows(10_000_000, 2), withRows(10_000_000, 3));
        const calls = probe.mock.calls.length;

        probe.mockRestore();

        expect([...changed]).toEqual(['rows.9999999.n']);
        expect(calls).toBeLessThan(1000);
    });

    test('a dense long array keeps the allocation-free index loop', () => {
        const rows = Array.from({length: 10_000}, (_, id) => ({id}));
        const next = rows.slice();

        next[5000] = {id: -1};

        const keys = rstest.spyOn(Object, 'keys');
        const changed = diffPaths({rows}, {rows: next});
        const longArrayKeys = keys.mock.calls.filter(([target]) => Array.isArray(target)).length;

        keys.mockRestore();

        expect([...changed]).toEqual(['rows.5000.id']);
        expect(longArrayKeys).toEqual(0);
    });

    test('reports added and removed slots and the key marker like the dense walk', () => {
        const before = withRows(5000, 2);
        const after = withRows(5000, 2);

        Reflect.deleteProperty(after.rows, "3");
        after.rows[10] = {n: 9};

        const changed = [...diffPaths(before, after)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

        expect(changed).toEqual(['rows.10', 'rows.3', 'rows.~k']);
    });
});

describe('diffPaths past the path threshold still stores no engine view (R32-01)', () => {
    test('a view in the part of the value the aborted walk never reached is exchanged', () => {
        const view = (new Carburetor({z: {n: 1}}).read(() => undefined) as {z: object}).z;
        const before = {a: Array.from({length: 2500}, (_, index) => index), z: {n: 1}};
        const after = {a: Array.from({length: 2500}, (_, index) => index + 1), z: view};

        expect(types.isProxy(after.z)).toBe(true);

        const changed = diffPaths(before, after);

        expect([...changed]).toEqual(['*']);
        expect(types.isProxy(after.z)).toBe(false);
    });
});
