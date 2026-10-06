import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from '@/Carburetor';
import {CARBURETOR_PATHS_SINCE} from '@/Carburetor/Store/Utils/Models';
import {useCarburetorValue} from '@/Interop';

interface IRow {
    id: number;
    title: string;
    done: boolean;
    tags: {a: number};
}

interface IData {
    items: IRow[];
    other: number;
}

const COUNT = 2000;

/** Counts every path the hook's tracked reads record: the work a selection walk does. */
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

const makeData = (): IData => ({
    items: Array.from({length: COUNT}, (_, id) => ({id, title: `t${id}`, done: false, tags: {a: id}})),
    other: 0,
});

const newRow = (title: string): IRow => ({id: COUNT, title, done: false, tags: {a: 0}});

const selectItems = (data: IData): IRow[] => data.items;

const mount = (store: CountingCarburetor): {latest: () => IRow[]; renders: () => number} => {
    let renders = 0;
    let latest: IRow[] = [];
    const List = (): React.ReactElement => {
        const items = useCarburetorValue(store, selectItems);
        // Test instrumentation, not render state.
        // oxlint-disable-next-line react/immutability, react/globals
        renders++;
        // oxlint-disable-next-line react/immutability, react/globals
        latest = items;

        return <p>{items.length}</p>;
    };
    render(<List />);

    return {latest: () => latest, renders: () => renders};
};

describe('a hook returning the live list patches from the write log (R36-01)', () => {
    test('a one-field write reads a handful of paths, not the selection', () => {
        const store = new CountingCarburetor(makeData());
        const view = mount(store);
        const before = view.latest();
        store.recorded = 0;

        act(() => { store.edit((draft) => { draft.items[7].title = 'edited'; }); });

        expect(store.recorded).toBeLessThan(40);
        expect(view.latest()[7].title).toBe('edited');
        expect(view.latest()[8]).toBe(before[8]);
        expect(view.latest()).not.toBe(before);
    });

    test('control: a push changes the key set, takes the full walk, and the counter shows it', () => {
        const store = new CountingCarburetor(makeData());
        const view = mount(store);
        store.recorded = 0;

        act(() => { store.edit((draft) => { draft.items.push(newRow('n')); }); });

        expect(store.recorded).toBeGreaterThan(COUNT);
        expect(view.latest()).toHaveLength(COUNT + 1);
    });

    test('a leaf the walk never read still wakes the hook after a patch', () => {
        const store = new CountingCarburetor(makeData());
        const view = mount(store);

        act(() => { store.edit((draft) => { draft.items[3].title = 'one'; }); });
        const rendersAfterPatch = view.renders();
        act(() => { store.edit((draft) => { draft.items[3].tags = {a: 99}; }); });

        expect(view.latest()[3].tags).toEqual({a: 99});
        expect(view.renders()).toBe(rendersAfterPatch + 1);

        act(() => { store.edit((draft) => { draft.items[3].tags.a = 100; }); });

        expect(view.latest()[3].tags).toEqual({a: 100});
        expect(view.renders()).toBe(rendersAfterPatch + 2);
    });

    test('an unrelated write renders nothing and the next related write still patches', () => {
        const store = new CountingCarburetor(makeData());
        const view = mount(store);
        const first = view.renders();

        act(() => { store.edit((draft) => { draft.other = 5; }); });
        expect(view.renders()).toBe(first);
        store.recorded = 0;
        act(() => { store.edit((draft) => { draft.items[1].done = true; }); });

        expect(store.recorded).toBeLessThan(40);
        expect(view.latest()[1].done).toBe(true);
    });

    test('fallbacks stay correct: a write to the list itself, a push and a key-set change', () => {
        const store = new CountingCarburetor(makeData());
        const view = mount(store);

        act(() => { store.edit((draft) => { draft.items.push(newRow('new')); }); });
        expect(view.latest()).toHaveLength(COUNT + 1);
        expect(view.latest()[COUNT].title).toBe('new');

        act(() => { store.edit((draft) => { delete (draft.items[2] as Partial<IRow>).done; }); });
        expect('done' in view.latest()[2]).toBe(false);

        act(() => {
            store.edit((draft) => {
                draft.items = draft.items.slice(1).map((row) => ({...row, tags: {...row.tags}}));
            });
        });
        expect(view.latest()[0].id).toBe(1);
    });

    test('control: without the log the same write walks the whole selection', () => {
        const store = new CountingCarburetor(makeData());
        Object.defineProperty(store, CARBURETOR_PATHS_SINCE, {value: undefined});
        const view = mount(store);
        store.recorded = 0;

        act(() => { store.edit((draft) => { draft.items[7].title = 'edited'; }); });

        expect(store.recorded).toBeGreaterThan(COUNT);
        expect(view.latest()[7].title).toBe('edited');
    });
});
