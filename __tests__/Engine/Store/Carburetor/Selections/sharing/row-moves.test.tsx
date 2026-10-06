import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';

interface IRow {
    id: number;
    title: string;
}

interface IData {
    rows: IRow[];
}

const COUNT = 40;

class RowsCarburetor extends Carburetor<IData> {
    public edit = (fn: (rows: IRow[]) => void): void => {
        this.update((draft: IData): void => {
            fn(draft.rows);
        });
    };
}

const renderedIds: number[] = [];

const MemoRow = React.memo(function MemoRow({row}: {row: IRow}): React.ReactElement {
    // Test instrumentation, not render state.
    // oxlint-disable-next-line react/immutability
    renderedIds.push(row.id);

    return <li>{row.title}</li>;
});

const RowsList = ({store}: {store: RowsCarburetor}): React.ReactElement => {
    const rows = useCarburetorValue(store, (data: IData): IRow[] => data.rows);

    return <ul>{rows.map((row: IRow): React.ReactElement => <MemoRow key={row.id} row={row} />)}</ul>;
};

const mount = (): {store: RowsCarburetor; text: () => string[]} => {
    const store = new RowsCarburetor({rows: Array.from({length: COUNT}, (_, id) => ({id, title: `r${id}`}))});
    const view = render(<RowsList store={store} />);
    renderedIds.length = 0;

    return {store, text: (): string[] => [...view.container.querySelectorAll('li')].map(li => li.textContent ?? '')};
};

const middle = (ids: number[]): number[] => ids.filter(id => id > 0 && id < COUNT - 1);

describe('memo rows follow a moved row by identity (R36-06)', () => {
    test('inserting at the top renders the new row, not the list', () => {
        const {store, text} = mount();

        act(() => { store.edit(rows => { rows.unshift({id: -1, title: 'new'}); }); });

        expect(renderedIds).toContain(-1);
        // The engine's own copy-on-assign may re-render the two ends; the middle never.
        expect(middle(renderedIds)).toEqual([]);
        expect(renderedIds.length).toBeLessThanOrEqual(3);
        expect(text().slice(0, 3)).toEqual(['new', 'r0', 'r1']);
        expect(text()).toHaveLength(COUNT + 1);
    });

    test('moving one row to position 1 re-renders no row between', () => {
        const {store, text} = mount();

        act(() => {
            store.edit(rows => {
                const [moved] = rows.splice(COUNT - 1, 1);
                rows.splice(1, 0, moved);
            });
        });

        expect(middle(renderedIds)).toEqual([]);
        expect(renderedIds.length).toBeLessThanOrEqual(2);
        expect(text().slice(0, 3)).toEqual(['r0', `r${COUNT - 1}`, 'r1']);
    });

    test('removing a row from the middle re-renders none of the survivors in the middle', () => {
        const {store, text} = mount();

        act(() => { store.edit(rows => { rows.splice(20, 1); }); });

        expect(middle(renderedIds)).toEqual([]);
        expect(text()).toHaveLength(COUNT - 1);
        expect(text()).not.toContain('r20');
    });

    test('an edit after a move re-renders only the edited row (control: the counter counts)', () => {
        const {store, text} = mount();

        act(() => { store.edit(rows => { rows.unshift({id: -1, title: 'new'}); }); });
        renderedIds.length = 0;
        act(() => { store.edit(rows => { rows[6].title = 'edited'; }); });

        expect(renderedIds).toEqual([5]);
        expect(text()[6]).toBe('edited');
    });
});
