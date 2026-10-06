import {Carburetor} from "@/Carburetor";
import {diffPaths} from "@/Carburetor/Store/Paths/Diff/diffPaths";
import {TPath} from "@/Carburetor/Models/Paths";

interface IData {rows: Array<{title: number}>; unrelated: {value: number}}
const make = (count: number, changed: number): IData => ({
    rows: Array.from({length: count}, (_, index) => ({title: index < changed ? index + 1 : index})),
    unrelated: {value: 1},
});

class Store extends Carburetor<IData> {}

const reads = (path: string): ReadonlySet<TPath> => new Set([path]);

describe('R36-05 relative diff fallback', () => {
    test('keeps a partial root diff precise above 2000 paths', () => {
        const previous = make(5000, 0);
        const next = make(5000, 2010);
        const paths = diffPaths(previous, next);
        expect(paths.has('rows.0.title')).toBe(true);
        expect(paths.has('rows.2009.title')).toBe(true);
        expect(paths.has('')).toBe(false);
        expect(paths.has('*')).toBe(false);
    });

    test('keeps same-kind root siblings asleep in setData and replacement fallback', () => {
        for (const changed of [2010, 5000]) {
            const store = new Store(make(5000, 0));
            let unrelated = 0;
            store.subscribe(() => unrelated++, {reads: reads('unrelated.value')});
            store.setData(make(5000, changed));
            expect(unrelated).toBe(0);
        }
    });

    test('same-kind root fallback keeps changed top-level keys precise', () => {
        const previous = make(5000, 0);
        const next = make(5000, 5000);
        const paths = diffPaths(previous, next);
        expect(paths.has('rows')).toBe(true);
        expect(paths.has('unrelated')).toBe(false);
        expect(paths.has('*')).toBe(false);
    });

    test('relative threshold retains 2000-leaf floor and requires strictly over half', () => {
        const small = make(3000, 0);
        expect(diffPaths(small, make(3000, 2000)).size).toBe(2000);
        const half = make(5000, 0);
        expect(diffPaths(half, make(5000, 2500)).size).toBe(2500);
    });
});
