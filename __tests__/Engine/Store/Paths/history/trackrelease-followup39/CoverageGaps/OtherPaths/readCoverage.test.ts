import {readCoverage} from "@/Carburetor/Store/Paths/Markers/readCoverage";

describe('readCoverage', () => {
    test('covers implied presence, prunes redundant markers, and extends immutably', () => {
        const filed = new Set(['tree.child.value']) as never;
        expect(readCoverage.covers(filed, 'tree.~p')).toBe(true);
        const scratch = new Set(['tree.~p', 'tree.child.value']);
        readCoverage.prune(scratch);
        expect(scratch.has('tree.~p')).toBe(false);
        const added = readCoverage.extend(filed, new Set(['other.value'])) as ReadonlySet<string>;
        expect([...added]).toEqual(['tree.child.value', 'other.value']);
        expect([...filed]).toEqual(['tree.child.value']);
    });
});
