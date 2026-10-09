import {completeReads} from '@/Carburetor/Store/Tracking/Observation/completeReads';

for (const size of [1, 2, 3, 4, 5, 8, 9]) {
    test(`R40-02 pruning size ${size}: oracle and small allocation boundary`, () => {
        const paths = ['a.~p', 'a.b.~p', 'a.b.~k', 'a~1b.~p', 'a~1b.c', 'alone.~p',
            'a~0p.~p', 'a~0p.c', 'other.value'].slice(0, size);
        const expected = paths.filter(path => !path.endsWith('.~p') || !paths.some(other =>
            other !== path && other.startsWith(path.slice(0, -2))));
        const NativeSet = globalThis.Set;
        const reads = new NativeSet(paths);
        let allocations = 0;
        globalThis.Set = class extends NativeSet {
            constructor(values?: Iterable<unknown> | null) {
                super(values);
                allocations++;
            }
        } as SetConstructor;
        try { expect(completeReads(reads)).toBe(reads); }
        finally { globalThis.Set = NativeSet; }
        expect([...reads]).toEqual(expected);
        expect(allocations).toBe(size <= 8 ? 0 : 1);
    });
}
