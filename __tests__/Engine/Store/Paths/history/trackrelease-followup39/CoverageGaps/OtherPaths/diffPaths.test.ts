import {diffPaths} from "@/Carburetor/Store/Paths/Diff/diffPaths";

describe('diffPaths', () => {
    test('reports nested leaves and records reversible patches', () => {
        const patches: unknown[] = [];
        const paths = diffPaths({a: 1}, {a: 2, b: true}, '', [], (patch: unknown) => patches.push(patch));
        expect([...paths]).toEqual(expect.arrayContaining(['a', 'b']));
        expect(patches.length).toBe(2);
    });
});
