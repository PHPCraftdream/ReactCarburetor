import {Carburetor, deepClone} from '@/Carburetor';

interface IRowData {
    rows: {n: number; nested: {v: number}}[];
}

class RowStore extends Carburetor<IRowData> {
    public snapshotState(): IRowData {
        return this.snapshot();
    }
}

describe('deepClone prototype preservation (R32-08)', () => {
    test('a plain object copy still uses Object.prototype and copies fields', () => {
        const source = {a: 1, nested: {b: 2}};
        const copy = deepClone(source);

        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        expect(copy).toEqual(source);
        expect(copy.nested).not.toBe(source.nested);
    });

    test('a null-prototype dictionary stays null-prototype, including nested', () => {
        const source: Record<string, unknown> = Object.assign(Object.create(null), {n: 1});
        source.inner = Object.assign(Object.create(null), {m: 2});

        const copy = deepClone(source) as Record<string, unknown>;

        expect(Object.getPrototypeOf(copy)).toBe(null);
        expect(Object.getPrototypeOf(copy.inner)).toBe(null);
        expect(copy.n).toEqual(1);
        expect((copy.inner as Record<string, number>).m).toEqual(2);
    });

    test('an array subclass keeps its prototype, plain arrays stay Array', () => {
        class RowList extends Array<number> {}

        const rows = new RowList(1, 2, 3);
        const copy = deepClone(rows);

        expect(copy).toBeInstanceOf(RowList);
        expect([...(copy as number[])]).toEqual([1, 2, 3]);
        expect(Object.getPrototypeOf(deepClone([4, 5]))).toBe(Array.prototype);
    });

    test('an own key literally named __proto__ still lands as an own property', () => {
        const source: Record<string, unknown> = {safe: 1};
        Object.defineProperty(source, '__proto__',
            {value: {deep: true}, writable: true, enumerable: true, configurable: true});

        const copy = deepClone(source) as Record<string, unknown>;

        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        expect((copy as Record<string, Record<string, boolean>>).__proto__).toEqual({deep: true});
    });

    test('snapshot() of a store state keeps row prototypes and nested identity separation', () => {
        const store = new RowStore({
            rows: Array.from({length: 8}, (_, n: number) => ({n, nested: {v: n}})),
        });

        const snapshot = store.snapshotState();

        expect(snapshot.rows[3].n).toEqual(3);
        expect(snapshot.rows[3].nested).not.toBe(store.getData().rows[3].nested);
        store.update((draft: IRowData) => { draft.rows[3].nested.v = 99; });
        expect(snapshot.rows[3].nested.v).toEqual(3);
    });
});
