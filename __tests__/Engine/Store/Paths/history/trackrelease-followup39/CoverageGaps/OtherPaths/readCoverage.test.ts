import {branchPath} from "@/Carburetor/Store/Paths/Markers/BranchMarker";
import {keysPath} from "@/Carburetor/Store/Paths/Markers/KeysMarker";
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

    test('the presence marker it recognises is the one the read proxy files', () => {
        const filed = new Set(['user.name']) as never;

        expect(readCoverage.covers(filed, branchPath('user'))).toBe(true);
        expect(readCoverage.covers(filed, branchPath('other'))).toBe(false);
        // A key-set marker is not presence: only a read of the keys themselves covers it.
        expect(readCoverage.covers(filed, keysPath('user'))).toBe(false);
    });

    test('presence of a branch is not covered by the presence of a sibling branch', () => {
        const filed = new Set([branchPath('user.address'), 'user.address.city']) as never;

        expect(readCoverage.covers(filed, branchPath('user'))).toBe(true);
        expect(readCoverage.covers(filed, branchPath('user.address'))).toBe(true);
        expect(readCoverage.covers(filed, branchPath('user.phone'))).toBe(false);
    });

    test('coversAll answers for a whole set, and is false as soon as one path is uncovered', () => {
        const filed = new Set(['tree.child.value', 'x']) as never;

        expect(readCoverage.coversAll(filed, new Set(['tree.~p', 'x']))).toBe(true);
        expect(readCoverage.coversAll(filed, new Set(['tree.~p', 'y']))).toBe(false);
        expect(readCoverage.coversAll(filed, new Set())).toBe(true);
    });

    test('coversAll agrees with covers on every member of a larger read set', () => {
        const reads = new Set<string>();

        for (let index = 0; index < 40; index++) reads.add('rows.' + index + '.title');

        const paths = new Set<string>(['rows.~p', 'rows.3.~p', 'rows.40.~p', 'rows.7.title']);
        const filed = reads as never;
        const expected = [...paths].every(path => readCoverage.covers(filed, path));

        expect(readCoverage.coversAll(filed, paths)).toBe(expected);
        expect(expected).toBe(false);
    });
});
