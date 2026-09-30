import {CarburetorHistory} from '@/Carburetor';
import {React, act, render, AntiHookComponent, Carburetor, computed} from '../support';

interface IRow {
    title: string;
    done: boolean;
}

interface IListData {
    items: Record<string, IRow>;
}

const buildList = (ids: string[]): IListData => ({
    items: Object.fromEntries(ids.map((id: string): [string, IRow] => [id, {title: id, done: false}])),
});

class ListCarburetor extends Carburetor<IListData> {
    public setTitle = (id: string, title: string): void => {
        this.update((draft: IListData) => {
            draft.items[id].title = title;
        });
    };

    /** The README's write example: replaces the whole record, keeping its key set. */
    public replaceKeepingKeys = (id: string, title: string): void => {
        this.update((draft: IListData) => {
            const previous = draft.items[id];

            draft.items[id] = {...previous, title};
        });
    };

    /** Replaces the whole record with one extra key, changing the record's own key set. */
    public replaceWithDifferentKeys = (id: string): void => {
        this.update((draft: IListData) => {
            const previous = draft.items[id];

            draft.items[id] = {...previous, extra: true} as unknown as IRow;
        });
    };
}

interface IRowProps {
    store: ListCarburetor;
    id: string;
    onRender: (id: string) => void;
}

class TitleRow extends AntiHookComponent<IRowProps> {
    render() {
        this.props.onRender(this.props.id);

        const data = this.useCarburetor(this.props.store);

        return <li>{data.items[this.props.id].title}</li>;
    }
}

class DoneRow extends AntiHookComponent<IRowProps> {
    render() {
        this.props.onRender(this.props.id);

        const data = this.useCarburetor(this.props.store);

        return <li>{String(data.items[this.props.id].done)}</li>;
    }
}

interface IEnumeratorProps {
    store: ListCarburetor;
    id: string;
    onRender: () => void;
}

/** Enumerates one item's own keys — the target of a key-set change on a replacement. */
class ItemKeysEnumerator extends AntiHookComponent<IEnumeratorProps> {
    render() {
        this.props.onRender();

        const data = this.useCarburetor(this.props.store);

        return <span>{Object.keys(data.items[this.props.id]).length}</span>;
    }
}

describe('undo/redo through CarburetorHistory wake precisely (R16-02)', () => {
    test('undo of one title edit wakes only that row; redo wakes only that row', () => {
        const ids = ['row0', 'row1', 'row2', 'row3', 'row4', 'row5'];
        const store = new ListCarburetor(buildList(ids));
        const history = new CarburetorHistory<IListData>(store);
        const rowRenders: Record<string, number> = {};
        const onRender = (id: string): void => {
            rowRenders[id] = (rowRenders[id] ?? 0) + 1;
        };

        const {unmount} = render(
            <ul>
                {ids.map((id: string) => <TitleRow key={id} store={store} id={id} onRender={onRender} />)}
            </ul>
        );

        ids.forEach((id: string) => expect(rowRenders[id]).toEqual(1));

        act(() => store.setTitle('row2', 'changed'));

        expect(rowRenders.row2).toEqual(2);
        ids.filter((id: string) => id !== 'row2').forEach((id: string) => expect(rowRenders[id]).toEqual(1));

        act(() => {
            expect(history.undo()).toBeTruthy();
        });

        expect(rowRenders.row2).toEqual(3);
        ids.filter((id: string) => id !== 'row2').forEach((id: string) => expect(rowRenders[id]).toEqual(1));

        act(() => {
            expect(history.redo()).toBeTruthy();
        });

        expect(rowRenders.row2).toEqual(4);
        ids.filter((id: string) => id !== 'row2').forEach((id: string) => expect(rowRenders[id]).toEqual(1));

        history.disconnect();
        unmount();
    });
});

describe('replacing a record wakes precisely (R16-03)', () => {
    test('replacing an item, keeping its key set, wakes only the field that changed', () => {
        const store = new ListCarburetor(buildList(['a', 'b']));
        const doneOfA = computed<boolean>((read) => read(store).items.a.done);
        let doneComputedRecomputes = 0;

        doneOfA.subscribe(() => doneComputedRecomputes++, {id: 'done-of-a'});
        doneOfA.get();

        const titleRenders: Record<string, number> = {};
        const doneRenders: Record<string, number> = {};
        const onTitleRender = (id: string): void => {
            titleRenders[id] = (titleRenders[id] ?? 0) + 1;
        };
        const onDoneRender = (id: string): void => {
            doneRenders[id] = (doneRenders[id] ?? 0) + 1;
        };

        const {unmount} = render(
            <div>
                <TitleRow store={store} id="a" onRender={onTitleRender} />
                <DoneRow store={store} id="a" onRender={onDoneRender} />
            </div>
        );

        expect(titleRenders.a).toEqual(1);
        expect(doneRenders.a).toEqual(1);

        act(() => store.replaceKeepingKeys('a', 'renamed'));

        expect(titleRenders.a).toEqual(2);
        // Neither the `done` reader nor the computed reading only `done` were touched.
        expect(doneRenders.a).toEqual(1);
        expect(doneComputedRecomputes).toEqual(0);

        unmount();
    });

    test('replacing a record, keeping its key set, does not wake an enumerator of it; a different key set does', () => {
        const store = new ListCarburetor(buildList(['a', 'b']));
        let enumeratorRenders = 0;

        const {unmount} = render(
            <ItemKeysEnumerator store={store} id="a" onRender={() => enumeratorRenders++} />
        );

        expect(enumeratorRenders).toEqual(1);

        act(() => store.replaceKeepingKeys('a', 'renamed'));
        expect(enumeratorRenders).toEqual(1);

        act(() => store.replaceWithDifferentKeys('a'));
        expect(enumeratorRenders).toEqual(2);

        unmount();
    });
});
