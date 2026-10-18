import {completeReads} from '@/Carburetor/Store/Tracking/Observation/completeReads';

const completed = (paths: string[]): Set<string> => new Set(completeReads(new Set(paths)));

describe('marker pruning keeps exact branch coverage on large sets', () => {
    test('a deep descendant without a direct child read still implies its ancestor marker', () => {
        // Non-hierarchical shape: no `a.b.~p` was recorded, the scan fallback decides.
        expect([...completed(['a.~p', 'a.b.c', 'z.~p'])]).toEqual(['a.b.c', 'z.~p']);
    });

    test('sibling markers retire only the branch that owns a recorded path', () => {
        const paths = ['b0.~p', 'b0.x'];
        for (let index = 1; index < 40; index++) paths.push('b' + index + '.~p');
        expect([...completed(paths)]).toEqual([
            'b0.x',
            ...Array.from({length: 39}, (_, index) => 'b' + (index + 1) + '.~p'),
        ]);
    });

    test('a keys marker implies the presence marker of its own branch', () => {
        expect([...completed(['items.~p', 'items.~k', 'other.~p'])]).toEqual(['items.~k', 'other.~p']);
    });

    test('presence markers of childless branches survive a large completion', () => {
        const paths = ['user.~p'];
        for (let index = 0; index < 20; index++) paths.push('items.r' + index + '.title');
        expect([...completed(paths)]).toEqual(['user.~p', ...paths.slice(1)]);
    });
});
