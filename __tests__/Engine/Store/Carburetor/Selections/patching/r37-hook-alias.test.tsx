import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';

interface IRow {
    id: string;
    n: number;
    link: Map<string, IRow> | null;
}

interface IData {
    rows: IRow[];
    other: number;
}

class AliasCarburetor extends Carburetor<IData> {
    public edit = (fn: (draft: IData) => void): void => {
        this.update(fn);
    };
}

const makeStore = (shared: boolean): AliasCarburetor => {
    const rows: IRow[] = [
        {id: 'a', n: 1, link: null},
        {id: 'b', n: 1, link: null},
    ];
    if (shared) rows[0].link = new Map([['row', rows[1]]]);
    return new AliasCarburetor({rows, other: 0});
};

const mount = (store: AliasCarburetor): {latest: () => IRow[]; renders: () => number} => {
    let renders = 0;
    let latest: IRow[] = [];
    const List = (): React.ReactElement => {
        const rows = useCarburetorValue(store, (data: IData) => data.rows);
        // Test instrumentation, not render state.
        // oxlint-disable-next-line react/immutability, react/globals
        renders++;
        // oxlint-disable-next-line react/immutability, react/globals
        latest = rows;

        return <p>{rows[1].n}</p>;
    };
    render(<List />);

    return {latest: () => latest, renders: () => renders};
};

describe.each([
    ['initial sharing', true],
    ['introduced sharing', false],
] as const)('useCarburetorValue keeps the native/plain alias (%s)', (_name, shared) => {
    test('both edits deliver the alias and the linked value', () => {
        const store = makeStore(shared);
        const rawRow = store.getData().rows[1];
        const view = mount(store);
        const initial = view.latest();

        if (!shared) {
            act(() => { store.edit((draft) => { draft.rows[0].link = new Map([['row', rawRow]]); }); });
        }

        act(() => { store.edit((draft) => { draft.rows[1].n = 2; }); });
        const afterFirst = view.latest();
        act(() => { store.edit((draft) => { draft.rows[1].n = 3; }); });

        const afterSecond = view.latest();
        for (const snapshot of [afterFirst, afterSecond]) {
            expect((snapshot[0].link as Map<string, IRow>).get('row')).toBe(snapshot[1]);
        }
        expect(afterFirst[1].n).toBe(2);
        expect(afterSecond[1].n).toBe(3);
        // The held initial snapshot is untouched: alias intact, value still 1.
        expect(initial[1].n).toBe(1);
        if (shared) {
            expect((initial[0].link as Map<string, IRow>).get('row')).toBe(initial[1]);
        } else {
            expect(initial[0].link).toBeNull();
        }
    });
});
