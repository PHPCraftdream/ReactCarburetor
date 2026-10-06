import {Carburetor} from '@/Carburetor';

interface IRow {
    id: number;
    n: number;
}

interface IData {
    rows: IRow[];
    other: number;
}

const COUNT = 4000;

class CountingCarburetor extends Carburetor<IData> {
    public recorded = 0;

    public override read(record: Parameters<Carburetor<IData>['read']>[0]): ReturnType<Carburetor<IData>['read']> {
        return super.read((path) => {
            this.recorded++;
            record(path);
        });
    }

    public edit = (fn: (draft: IData) => void): void => {
        this.update(fn);
    };
}

const makeStore = (): CountingCarburetor => new CountingCarburetor({
    rows: Array.from({length: COUNT}, (_, id) => ({id, n: 0})),
    other: 0,
});

const editLeaves = (store: CountingCarburetor, changed: number): void => {
    store.edit((draft) => {
        for (let index = 0; index < changed; index++) {
            draft.rows[index * 2].n = index + 1;
        }
    });
};

describe('the patch decision follows relative work, not an absolute path count (R37-04)', () => {
    test('65 changed leaves on a large list still patch instead of walking the selection', () => {
        const store = makeStore();
        let latest: IRow[] = [];
        const stop = store.watch((data: IData) => data.rows, (next) => { latest = next; });
        store.recorded = 0;

        editLeaves(store, 65);

        // Patch work stays proportional to the batch: 65 paths + spines, not 2*COUNT + 1.
        expect(store.recorded).toBeLessThan(400);
        expect(latest.filter((row) => row.n !== 0)).toHaveLength(65);
        expect(latest[128].n).toBe(65);
        stop();
    });

    test('128 changed leaves on the same list are still bounded', () => {
        const store = makeStore();
        let latest: IRow[] = [];
        const stop = store.watch((data: IData) => data.rows, (next) => { latest = next; });
        store.recorded = 0;

        editLeaves(store, 128);

        expect(store.recorded).toBeLessThan(800);
        expect(latest.filter((row) => row.n !== 0)).toHaveLength(128);
        stop();
    });

    test('a dense batch honestly takes the full walk and stays correct', () => {
        const store = makeStore();
        let latest: IRow[] = [];
        const stop = store.watch((data: IData) => data.rows, (next) => { latest = next; });
        store.recorded = 0;

        store.edit((draft) => {
            for (let index = 0; index < COUNT; index++) draft.rows[index].n = 7;
        });

        // Every row read at least once: the whole selection was walked.
        expect(store.recorded).toBeGreaterThan(COUNT);
        expect(latest[COUNT - 1].n).toBe(7);
        stop();
    });
});
