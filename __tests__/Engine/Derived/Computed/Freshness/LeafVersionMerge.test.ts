import {Carburetor, computed} from '@/Carburetor';

interface IRowData {
    rows: {a: number; b: number; c: number; d: number; e: number}[];
}

describe('computed fan-in over one shared store (R32-02)', () => {
    const K = 128;
    const FIELDS = 5;

    test('one outer recompute performs O(K·M) set insertions, not O(K²·M)', () => {
        class RowStore extends Carburetor<IRowData> {
            public bump(): void {
                this.update((draft: IRowData) => { draft.rows[K - 1].a++; });
            }
        }

        const store = new RowStore({
            rows: Array.from({length: K}, (_, n) => ({a: n, b: n, c: n, d: n, e: n})),
        });
        const inner = Array.from({length: K}, (_, n: number) =>
            computed((read: (data: object) => IRowData) => {
                const row = read(store).rows[n];

                return row.a + row.b + row.c + row.d + row.e;
            }));

        let insertions = 0;
        const originalAdd = Set.prototype.add;
        Set.prototype.add = function add(value: unknown): Set<unknown> {
            insertions++;
            return originalAdd.call(this, value);
        };

        let outerRecomputes = 0;
        let wakes = 0;
        const outer = computed((read: (value: object) => number) => {
            outerRecomputes++;
            return inner.reduce((sum: number, item: object) => sum + read(item), 0);
        });
        const watcher = outer.subscribe(() => wakes++);
        outer.get();
        insertions = 0;

        store.bump();
        const value = outer.get();

        Set.prototype.add = originalAdd;
        outer.unsubscribe(watcher);

        expect(value).toEqual(FIELDS * (K * (K - 1) / 2) + 1);
        // Set construction from an iterable also goes through add: the fixed merge costs
        // O(K·M) insertions in total; the old copy-per-merge cost K²·M/2.
        expect(insertions).toBeLessThanOrEqual(3 * K * FIELDS);
        // The fix must not change the recompute or wake counts.
        expect(outerRecomputes).toEqual(2);
        expect(wakes).toEqual(1);
    });
});
