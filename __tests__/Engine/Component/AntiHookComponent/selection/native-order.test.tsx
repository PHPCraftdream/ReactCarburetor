import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor} from '@/Carburetor';
import {TReadonly} from '@/Carburetor/Models/Base';
import {useCarburetorValue} from '@/Interop';

interface INativeData {
    // oxlint-disable-next-line carburetor/no-untrackable-store-data
    map: Map<string, number>;
    // oxlint-disable-next-line carburetor/no-untrackable-store-data
    set: Set<string>;
}

interface INativeSelection {
    map: ReadonlyMap<string, number>;
    set: ReadonlySet<string>;
}

const makeNativeData = (
    entries: Array<[string, number]> = [['a', 1], ['b', 2]],
    members: string[] = ['x', 'y']
): INativeData => ({map: new Map(entries), set: new Set(members)});

const describeNative = (selection: INativeSelection): string =>
    Array.from(selection.map, ([key, value]) => `${key}:${value}`).join(',') + '|' +
    Array.from(selection.set).join(',');

interface IAliasRow {
    value: number;
}

interface IAliasData {
    sharedMaps: boolean;
    sharedRow: boolean;
    revision: number;
    row: IAliasRow;
    // oxlint-disable-next-line carburetor/no-untrackable-store-data
    firstMap: Map<string, IAliasRow>;
    // oxlint-disable-next-line carburetor/no-untrackable-store-data
    secondMap: Map<string, IAliasRow>;
}

interface IAliasSelection {
    first: TReadonly<Map<string, IAliasRow>>;
    second: TReadonly<Map<string, IAliasRow>>;
    row: TReadonly<IAliasRow>;
    parity: number;
}

const makeAliasData = (
    sharedMaps: boolean,
    sharedRow: boolean,
    value: number,
    revision: number
): IAliasData => {
    const row = {value};
    const firstMap = new Map<string, IAliasRow>([['row', sharedRow ? row : {value}]]);
    const secondMap = sharedMaps
        ? firstMap
        : new Map<string, IAliasRow>([['row', sharedRow ? row : {value}]]);

    return {sharedMaps, sharedRow, revision, row, firstMap, secondMap};
};

const selectAlias = (data: TReadonly<IAliasData>): IAliasSelection => {
    const selectedMap = data.sharedMaps ? data.firstMap : data.secondMap;
    const parity = data.revision % 2;

    return {first: selectedMap, second: data.firstMap, row: data.row, parity};
};

const describeAlias = (selection: IAliasSelection): string => {
    const mapRow = selection.second.get('row');
    const sharesMap = selection.first === selection.second;
    const sharesRow = selection.row === mapRow;

    return `${sharesMap}:${sharesRow}:${selection.row.value}:${mapRow?.value}`;
};

describe('ordered native selection snapshots reach React consumers (R31-01)', () => {
    test('the hook preserves equal snapshots and renders Map/Set reorder and value changes', async () => {
        const store = new Carburetor<INativeData>(makeNativeData());
        let renders = 0;

        const NativeView = () => {
            renders++;
            const selection = useCarburetorValue(store, (data: TReadonly<INativeData>) => ({
                map: data.map,
                set: data.set,
            }));

            return <div>{describeNative(selection)}</div>;
        };

        const {container, unmount} = render(<NativeView />);

        expect(container.textContent).toBe('a:1,b:2|x,y');
        expect(renders).toBe(1);

        await act(async () => { store.setData(makeNativeData()); });
        expect(container.textContent).toBe('a:1,b:2|x,y');
        expect(renders).toBe(1);

        await act(async () => { store.setData(makeNativeData([['b', 2], ['a', 1]], ['y', 'x'])); });
        expect(container.textContent).toBe('b:2,a:1|y,x');
        expect(renders).toBe(2);

        await act(async () => { store.setData(makeNativeData([['b', 2], ['a', 9]], ['y', 'x', 'z'])); });
        expect(container.textContent).toBe('b:2,a:9|y,x,z');
        expect(renders).toBe(3);

        unmount();
    });

    test('connectSelection passes changed ordered snapshots to a memo child', async () => {
        const store = new Carburetor<INativeData>(makeNativeData());
        let memoRenders = 0;
        const MemoNative = React.memo(({selection}: {selection: INativeSelection}) => {
            memoRenders++;

            return <span>{describeNative(selection)}</span>;
        });

        class Parent extends AntiHookComponent<{flag?: string}> {
            private readonly selected = this.connectSelection(
                () => store,
                (data: TReadonly<INativeData>) => ({map: data.map, set: data.set})
            );

            public render() {
                return <MemoNative selection={this.selected()} />;
            }
        }

        const {container, unmount} = render(<Parent />);

        expect(container.textContent).toBe('a:1,b:2|x,y');
        expect(memoRenders).toBe(1);

        await act(async () => { store.setData(makeNativeData()); });
        expect(container.textContent).toBe('a:1,b:2|x,y');
        expect(memoRenders).toBe(1);

        await act(async () => { store.setData(makeNativeData([['b', 2], ['a', 1]], ['y', 'x'])); });
        expect(container.textContent).toBe('b:2,a:1|y,x');
        expect(memoRenders).toBe(2);

        await act(async () => { store.setData(makeNativeData([['b', 8], ['a', 1]], ['y', 'x', 'z'])); });
        expect(container.textContent).toBe('b:8,a:1|y,x,z');
        expect(memoRenders).toBe(3);

        unmount();
    });

    test('the hook preserves repeated Map aliases and detects plain/native bridge changes', async () => {
        const store = new Carburetor<IAliasData>(makeAliasData(true, true, 1, 0));
        let renders = 0;
        const AliasView = () => {
            renders++;
            const selection = useCarburetorValue(store, selectAlias);

            return <span>{describeAlias(selection)}</span>;
        };
        const {container, unmount} = render(<AliasView />);

        expect(container.textContent).toBe('true:true:1:1');

        await act(async () => { store.setData(makeAliasData(true, true, 1, 2)); });
        expect(container.textContent).toBe('true:true:1:1');
        expect(renders).toBe(1);

        await act(async () => { store.setData(makeAliasData(false, true, 1, 4)); });
        expect(container.textContent).toBe('false:true:1:1');
        expect(renders).toBe(2);

        await act(async () => { store.setData(makeAliasData(true, false, 1, 6)); });
        expect(container.textContent).toBe('true:false:1:1');
        expect(renders).toBe(3);

        await act(async () => { store.setData(makeAliasData(true, false, 2, 8)); });
        expect(container.textContent).toBe('true:false:2:2');
        expect(renders).toBe(4);

        await act(async () => { store.setData(makeAliasData(true, true, 2, 10)); });
        expect(container.textContent).toBe('true:true:2:2');
        expect(renders).toBe(5);

        unmount();
    });

    test('the memo child sees repeated Map aliases and plain/native bridge topology', async () => {
        const store = new Carburetor<IAliasData>(makeAliasData(true, true, 1, 0));
        let memoRenders = 0;
        const MemoAlias = React.memo(({selection}: {selection: IAliasSelection}) => {
            memoRenders++;

            return <span>{describeAlias(selection)}</span>;
        });

        class Parent extends AntiHookComponent<{flag?: string}> {
            private readonly selected = this.connectSelection(() => store, selectAlias);

            public render() {
                return <MemoAlias selection={this.selected()} />;
            }
        }

        const {container, unmount} = render(<Parent />);

        expect(container.textContent).toBe('true:true:1:1');
        expect(memoRenders).toBe(1);

        await act(async () => { store.setData(makeAliasData(true, true, 1, 2)); });
        expect(container.textContent).toBe('true:true:1:1');
        expect(memoRenders).toBe(1);

        await act(async () => { store.setData(makeAliasData(false, true, 1, 4)); });
        expect(container.textContent).toBe('false:true:1:1');
        expect(memoRenders).toBe(2);

        await act(async () => { store.setData(makeAliasData(true, false, 1, 6)); });
        expect(container.textContent).toBe('true:false:1:1');
        expect(memoRenders).toBe(3);

        await act(async () => { store.setData(makeAliasData(true, false, 2, 8)); });
        expect(container.textContent).toBe('true:false:2:2');
        expect(memoRenders).toBe(4);

        await act(async () => { store.setData(makeAliasData(true, true, 2, 10)); });
        expect(container.textContent).toBe('true:true:2:2');
        expect(memoRenders).toBe(5);

        unmount();
    });
});
