import {CoveredReads} from '@/Carburetor/Component/Models/CoveredReads';

const filedWith = (...paths: string[]): never => new Set(paths) as never;

describe('CoveredReads', () => {
    test('starts with the given paths without recording them into the own set again', () => {
        const own = new Set<string>(['a']);
        const reads = new CoveredReads(['a', 'b'], own, filedWith('x.y'));

        expect([...reads]).toEqual(['a', 'b']);
        expect([...own]).toEqual(['a']);
        expect(reads).toBeInstanceOf(Set);
    });

    test('a path the filed set covers is recorded into the own set only', () => {
        const own = new Set<string>();
        const reads = new CoveredReads([], own, filedWith('x.y', 'tree.child.value'));

        reads.add('x.y');
        reads.add('tree.~p');

        expect([...own]).toEqual(['x.y', 'tree.~p']);
        expect([...reads]).toEqual([]);
    });

    test('a path the filed set does not cover is recorded into both', () => {
        const own = new Set<string>();
        const reads = new CoveredReads([], own, filedWith('x.y'));

        reads.add('other');

        expect([...own]).toEqual(['other']);
        expect([...reads]).toEqual(['other']);
    });

    test('add stays chainable, and delete and has behave as on any set', () => {
        const reads = new CoveredReads(['a', 'b'], new Set<string>(), filedWith());

        expect(reads.add('c')).toBe(reads);
        expect(reads.has('c')).toBe(true);
        expect(reads.delete('a')).toBe(true);
        expect([...reads]).toEqual(['b', 'c']);
        expect(reads.size).toBe(2);
    });
});
