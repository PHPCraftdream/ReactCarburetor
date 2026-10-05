import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';

interface IRow {
    id: number;
    title: string;
    tags: string[];
}

interface IStoreData {
    rows: IRow[];
    other: number;
}

const getRow = (id: number, title: string): IRow => ({id, title, tags: [`t${id}`]});

const getRowsData = (): IStoreData => ({
    rows: [getRow(0, 'r0'), getRow(1, 'r1'), getRow(2, 'r2')],
    other: 0,
});

class RowsCarburetor extends Carburetor<IStoreData> {
    public setTitle = (index: number, title: string): void => {
        this.update((draft: IStoreData): void => {
            draft.rows[index].title = title;
        });
    };

    public setOther = (value: number): void => {
        this.update((draft: IStoreData): void => {
            draft.other = value;
        });
    };
}

const renderCounts: Record<number, number> = {};

const MemoRow = React.memo(function MemoRow({row}: {row: IRow}): React.ReactElement {
    // Test instrumentation, not render state: the counter intentionally lives outside React.
    // oxlint-disable-next-line react/immutability
    renderCounts[row.id] = (renderCounts[row.id] ?? 0) + 1;

    return <li className={`row-${row.id}`}>{row.title}</li>;
});

interface IListProps {
    store: RowsCarburetor;
    listRef: {current: IRow[] | undefined};
}

/**
 * The counter: the hook's snapshot must keep row identity for unchanged rows so a React.memo
 * row keyed on the row object bails out. Without R34-02 every row is a fresh copy.
 */
function RowsList({store, listRef}: IListProps): React.ReactElement {
    const rows = useCarburetorValue(store, (data: IStoreData): IRow[] => data.rows);

    // Report the latest snapshot to the test harness; render is where the hook hands it over.
    // oxlint-disable-next-line react/refs
    listRef.current = rows;

    return (
        <ul>
            {rows.map((row: IRow): React.ReactElement => <MemoRow key={row.id} row={row} />)}
        </ul>
    );
}

interface ISelProps {
    store: RowsCarburetor;
}

class SelectionParent extends AntiHookComponent<ISelProps> {
    private readonly selection = this.connectSelection(
        (): RowsCarburetor => this.props.store,
        (data: IStoreData): {rows: IRow[]; other: number} => ({rows: data.rows, other: data.other})
    );

    public snapshots: Array<{rows: IRow[]; other: number}> = [];

    public render(): React.ReactElement {
        const snapshot = this.selection();

        this.snapshots.push(snapshot);

        return <span className="other">{snapshot.other}</span>;
    }
}

describe('fused reconcile keeps memoized rows stable (R34-02 counter)', () => {
    test('editing one row re-renders exactly one memo row and preserves sibling identity', () => {
        const store = new RowsCarburetor(getRowsData());
        const listRef: {current: IRow[] | undefined} = {current: undefined};

        const {container, unmount} = render(<RowsList store={store} listRef={listRef} />);

        expect(renderCounts).toEqual({0: 1, 1: 1, 2: 1});
        const firstList = listRef.current as IRow[];
        expect(container.querySelector('.row-1')?.textContent).toEqual('r1');

        act((): void => {
            store.setTitle(1, 'edited');
        });

        expect(renderCounts).toEqual({0: 1, 1: 2, 2: 1});
        expect(container.querySelector('.row-1')?.textContent).toEqual('edited');

        const nextList = listRef.current as IRow[];
        expect(nextList).not.toBe(firstList);
        expect(nextList[0]).toBe(firstList[0]);
        expect(nextList[2]).toBe(firstList[2]);
        expect(nextList[1]).not.toBe(firstList[1]);
        expect(nextList[1].title).toEqual('edited');
        expect(nextList).toHaveLength(3);

        act((): void => {
            store.setTitle(2, 'second');
        });

        expect(renderCounts).toEqual({0: 1, 1: 2, 2: 2});
        expect(container.querySelector('.row-2')?.textContent).toEqual('second');

        unmount();
    });

    test('connectSelection: unchanged branches keep identity, the changed spine is new', () => {
        const store = new RowsCarburetor(getRowsData());
        const seen: Array<{rows: IRow[]; other: number}> = [];

        class Recorder extends SelectionParent {
            public render(): React.ReactElement {
                const snapshot = this.selection();

                seen.push(snapshot);

                return <span>{snapshot.other}</span>;
            }
        }

        const {unmount} = render(<Recorder store={store} />);
        expect(seen).toHaveLength(1);

        const first = seen[0];

        act((): void => {
            store.setTitle(1, 'edited');
        });

        expect(seen).toHaveLength(2);
        const second = seen[1];

        expect(second).not.toBe(first);
        expect(second.rows).not.toBe(first.rows);
        expect(second.rows[0]).toBe(first.rows[0]);
        expect(second.rows[2]).toBe(first.rows[2]);
        expect(second.rows[1]).not.toBe(first.rows[1]);
        expect(second.rows[1].title).toEqual('edited');

        act((): void => {
            store.setOther(7);
        });

        expect(seen).toHaveLength(3);
        const third = seen[2];

        expect(third).not.toBe(second);
        expect(third.rows).toBe(second.rows);
        expect(third.other).toEqual(7);

        unmount();
    });

    test('watch(next, previous): one leaf edit shares unchanged branches; unrelated writes stay silent', () => {
        const store = new RowsCarburetor(getRowsData());
        const calls: Array<[IRow[], IRow[]]> = [];

        const dispose = store.watch((data: IStoreData): IRow[] => data.rows, (next, previous): void => {
            calls.push([next as IRow[], previous as IRow[]]);
        });

        act((): void => {
            store.setTitle(1, 'edited');
        });

        expect(calls).toHaveLength(1);
        const [next, previous] = calls[0];

        expect(next).not.toBe(previous);
        expect(next[0]).toBe(previous[0]);
        expect(next[2]).toBe(previous[2]);
        expect(next[1]).not.toBe(previous[1]);
        expect(next[1].title).toEqual('edited');
        expect(next).toHaveLength(3);

        // A write outside the selection's read set must not wake onChange at all.
        act((): void => {
            store.setOther(9);
        });

        expect(calls).toHaveLength(1);

        dispose();
    });
});
