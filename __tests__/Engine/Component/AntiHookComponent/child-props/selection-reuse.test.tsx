import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor} from '@/Carburetor';
import {CARBURETOR_HAS_DRIFT, CARBURETOR_PATHS_SINCE} from '@/Carburetor/Store/Utils/Models';

interface IRow {
    id: number;
    title: string;
    tags: {a: number};
    note?: string;
}

interface IData {
    items: IRow[];
    other: number;
}

const COUNT = 1500;

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

interface IHandle {
    latest: () => IRow[];
    bump: () => void;
    renders: () => number;
}

const mount = (store: CountingCarburetor): IHandle => {
    let latest: IRow[] = [];
    let renders = 0;
    let bump = (): void => undefined;

    class List extends AntiHookComponent {
        state = {n: 0};

        private readonly items = this.connectSelection(() => store, (data) => data.items);

        render() {
            renders++;
            bump = (): void => this.setState({n: this.state.n + 1});
            latest = this.items();

            return <p>{latest.length}</p>;
        }
    }

    render(<List />);

    return {latest: () => latest, bump: () => bump(), renders: () => renders};
};

describe('connectSelection reuses its snapshot and read set across renders (R36-01)', () => {
    test('a render with no write walks nothing and keeps the snapshot', () => {
        const store = makeStore();
        const handle = mount(store);
        act(() => { handle.bump(); });
        const before = handle.latest();
        store.recorded = 0;

        act(() => { handle.bump(); });

        expect(store.recorded).toBeLessThan(40);
        expect(handle.latest()).toBe(before);
    });

    test('a one-field write is patched from the log, not walked', () => {
        const store = makeStore();
        const handle = mount(store);
        act(() => { handle.bump(); });
        const before = handle.latest();
        store.recorded = 0;

        act(() => { store.edit((draft) => { draft.items[9].title = 'edited'; }); });

        expect(store.recorded).toBeLessThan(60);
        expect(handle.latest()[9].title).toBe('edited');
        expect(handle.latest()[10]).toBe(before[10]);
        expect(handle.latest()).not.toBe(before);
    });

    test('a leaf the selection never read still wakes the component after a patch', () => {
        const store = makeStore();
        const handle = mount(store);
        act(() => { handle.bump(); });

        act(() => { store.edit((draft) => { draft.items[4].title = 'x'; }); });
        act(() => { store.edit((draft) => { draft.items[4].tags = {a: 50}; }); });
        const rendered = handle.renders();
        act(() => { store.edit((draft) => { draft.items[4].tags.a = 51; }); });

        expect(handle.latest()[4].tags).toEqual({a: 51});
        expect(handle.renders()).toBeGreaterThan(rendered);
    });

    test('control: without the log and the drift answer every render walks the whole selection', () => {
        const store = makeStore();
        Object.defineProperty(store, CARBURETOR_PATHS_SINCE, {value: undefined});
        Object.defineProperty(store, CARBURETOR_HAS_DRIFT, {value: undefined});
        const handle = mount(store);
        act(() => { handle.bump(); });
        store.recorded = 0;

        act(() => { handle.bump(); });

        expect(store.recorded).toBeGreaterThan(COUNT);
    });

    test('pushes, deletions and list replacement stay correct', () => {
        const store = makeStore();
        const handle = mount(store);
        act(() => { handle.bump(); });

        act(() => { store.edit((draft) => { draft.items.push({id: COUNT, title: 'n', tags: {a: 0}}); }); });
        expect(handle.latest()).toHaveLength(COUNT + 1);
        act(() => { store.edit((draft) => { delete draft.items[3].note; draft.items[3].note = 'z'; }); });
        expect(handle.latest()[3].note).toBe('z');
        act(() => { store.edit((draft) => { delete draft.items[3].note; }); });
        expect('note' in handle.latest()[3]).toBe(false);
        act(() => { handle.bump(); });
        expect(handle.latest()).toEqual(store.getData().items);
    });
});
