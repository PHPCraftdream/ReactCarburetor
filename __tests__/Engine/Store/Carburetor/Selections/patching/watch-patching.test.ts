import {Carburetor} from '@/Carburetor';
import {CARBURETOR_PATHS_SINCE} from '@/Carburetor/Store/Utils/Models';

interface IRow {
    id: number;
    title: string;
    tags: {a: number};
}

interface IData {
    items: IRow[];
    other: number;
}

const COUNT = 2000;

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
    items: Array.from({length: COUNT}, (_, id) => ({id, title: `t${id}`, tags: {a: id}})),
    other: 0,
});

const selectItems = (view: IData): IRow[] => view.items;

describe('watch() patches a live-list selection from the write log (R36-01)', () => {
    test('a one-field write reads a handful of paths and delivers the edited list', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch(selectItems, (next) => { seen.push(next); });
        store.recorded = 0;

        store.edit((draft) => { draft.items[11].title = 'edited'; });

        expect(store.recorded).toBeLessThan(40);
        expect(seen).toHaveLength(1);
        expect(seen[0][11].title).toBe('edited');
        expect(seen[0]).toEqual(store.getData().items);
        stop();
    });

    test('an unrelated write delivers nothing, a later related one still does', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch(selectItems, (next) => { seen.push(next); });

        store.edit((draft) => { draft.other = 3; });
        expect(seen).toHaveLength(0);
        store.edit((draft) => { draft.items[5].tags.a = 77; });

        expect(seen).toHaveLength(1);
        expect(seen[0][5].tags.a).toBe(77);
        stop();
    });

    test('a leaf the first walk never read still wakes the watch after a patch', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch(selectItems, (next) => { seen.push(next); });

        store.edit((draft) => { draft.items[2].title = 'a'; });
        store.edit((draft) => { draft.items[2].tags = {a: 5}; });
        store.edit((draft) => { draft.items[2].tags.a = 6; });

        expect(seen).toHaveLength(3);
        expect(seen[2][2].tags.a).toBe(6);
        stop();
    });

    test('a push and a key deletion fall back to the full walk and stay correct', () => {
        const store = makeStore();
        let latest: IRow[] = [];
        const stop = store.watch(selectItems, (next) => { latest = next; });

        store.edit((draft) => { draft.items.push({id: COUNT, title: 'n', tags: {a: 0}}); });
        expect(latest).toHaveLength(COUNT + 1);
        store.edit((draft) => { delete (draft.items[4] as Partial<IRow>).title; });
        expect('title' in latest[4]).toBe(false);
        expect(latest).toEqual(store.getData().items);
        stop();
    });

    test('control: without the log the same write walks the whole selection', () => {
        const store = makeStore();
        Object.defineProperty(store, CARBURETOR_PATHS_SINCE, {value: undefined});
        const stop = store.watch(selectItems, () => undefined);
        store.recorded = 0;

        store.edit((draft) => { draft.items[11].title = 'edited'; });

        expect(store.recorded).toBeGreaterThan(COUNT);
        stop();
    });
});
