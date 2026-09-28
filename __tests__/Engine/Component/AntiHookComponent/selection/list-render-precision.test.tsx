import {bind} from '@/Carburetor';
import {React, act, render, AntiHookComponent, Carburetor} from '../support';

interface IRow {
    title: string;
}

interface IListData {
    items: IRow[];
    other: number;
}

const buildList = (titles: string[]): IListData => ({
    items: titles.map((title: string): IRow => ({title})),
    other: 0,
});

class ListCarburetor extends Carburetor<IListData> {
    public push = (row: IRow): void => {
        this.update((draft: IListData): void => {
            draft.items.push(row);
        });
    };

    public replaceAt = (index: number, row: IRow): void => {
        this.update((draft: IListData): void => {
            draft.items[index] = row;
        });
    };

    public setTitle = (index: number, title: string): void => {
        this.update((draft: IListData): void => {
            draft.items[index].title = title;
        });
    };

    public truncate = (length: number): void => {
        this.update((draft: IListData): void => {
            draft.items.length = length;
        });
    };

    public removeAt = (index: number): void => {
        this.update((draft: IListData): void => {
            draft.items.splice(index, 1);
        });
    };

    public sortByTitle = (): void => {
        this.update((draft: IListData): void => {
            draft.items.sort((a: IRow, b: IRow): number => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
        });
    };

    public bumpOther = (): void => {
        this.update((draft: IListData): void => {
            draft.other++;
        });
    };
}

interface IRowProps {
    store: ListCarburetor;
    index: number;
    onRender: (index: number) => void;
}

class Row extends AntiHookComponent<IRowProps> {
    render() {
        this.props.onRender(this.props.index);

        const data = this.useCarburetor(this.props.store);

        return <li className={`row-${this.props.index}`}>{data.items[this.props.index].title}</li>;
    }
}

interface IParentProps {
    store: ListCarburetor;
    onRender: () => void;
    onRowRender: (index: number) => void;
}

/** Lays out rows with a plain length loop, the form the push/replace/truncate tests isolate. */
class LoopParent extends AntiHookComponent<IParentProps> {
    render() {
        this.props.onRender();

        const data = this.useCarburetor(this.props.store);
        const rows: React.ReactNode[] = [];

        for (let i = 0; i < data.items.length; i++) {
            rows.push(<Row key={i} store={this.props.store} index={i} onRender={this.props.onRowRender} />);
        }

        return <ul>{rows}</ul>;
    }
}

/** Lays out rows with items.map, the form the .map-parent test targets. */
class MapParent extends AntiHookComponent<IParentProps> {
    @bind
    private renderRow(_row: IRow, i: number): React.ReactElement {
        return <Row key={i} store={this.props.store} index={i} onRender={this.props.onRowRender} />;
    }

    render() {
        this.props.onRender();

        const data = this.useCarburetor(this.props.store);

        return <ul>{data.items.map(this.renderRow)}</ul>;
    }
}

interface IForOfProps {
    store: ListCarburetor;
    onRender: () => void;
}

class ForOfCounter extends AntiHookComponent<IForOfProps> {
    render() {
        this.props.onRender();

        const data = this.useCarburetor(this.props.store);
        let count = 0;

        for (const _row of data.items) {
            count++;
        }

        return <span className="count">{count}</span>;
    }
}

describe('a list of rows re-renders only what a write actually concerns', () => {
    test('pushing a row does not re-render an existing row; the parent re-renders once, for the length it read', () => {
        const store = new ListCarburetor(buildList(['a', 'b', 'c', 'd', 'e']));
        let parentRenders = 0;
        const rowRenders: Record<number, number> = {};
        const onRowRender = (index: number): void => {
            rowRenders[index] = (rowRenders[index] ?? 0) + 1;
        };

        const {container, unmount} = render(
            <LoopParent store={store} onRender={() => parentRenders++} onRowRender={onRowRender} />
        );

        expect(parentRenders).toEqual(1);
        expect(rowRenders).toEqual({0: 1, 1: 1, 2: 1, 3: 1, 4: 1});

        act(() => store.push({title: 'new'}));

        // The length read wakes the parent; no existing row's own subscription is touched.
        expect(parentRenders).toEqual(2);
        expect(rowRenders[0]).toEqual(1);
        expect(rowRenders[1]).toEqual(1);
        expect(rowRenders[2]).toEqual(1);
        expect(rowRenders[3]).toEqual(1);
        expect(rowRenders[4]).toEqual(1);
        // Only the new row mounts.
        expect(rowRenders[5]).toEqual(1);
        expect(container.querySelectorAll('li').length).toEqual(6);
        expect(container.querySelector('.row-5')?.textContent).toEqual('new');

        unmount();
    });

    test('replacing one row with a new object re-renders exactly that row', () => {
        const store = new ListCarburetor(buildList(['a', 'b', 'c', 'd', 'e']));
        let parentRenders = 0;
        const rowRenders: Record<number, number> = {};
        const onRowRender = (index: number): void => {
            rowRenders[index] = (rowRenders[index] ?? 0) + 1;
        };

        const {container, unmount} = render(
            <LoopParent store={store} onRender={() => parentRenders++} onRowRender={onRowRender} />
        );

        act(() => store.replaceAt(2, {title: 'replaced'}));

        expect(rowRenders[2]).toEqual(2);
        expect(rowRenders[0]).toEqual(1);
        expect(rowRenders[1]).toEqual(1);
        expect(rowRenders[3]).toEqual(1);
        expect(rowRenders[4]).toEqual(1);
        // The parent's only read is `items.length`, which a same-length replace never touches.
        expect(parentRenders).toEqual(1);
        expect(container.querySelector('.row-2')?.textContent).toEqual('replaced');

        unmount();
    });

    test('a parent laying out rows with items.map does not re-render when a row title changes', () => {
        const store = new ListCarburetor(buildList(['a', 'b', 'c', 'd', 'e']));
        let parentRenders = 0;
        const rowRenders: Record<number, number> = {};
        const onRowRender = (index: number): void => {
            rowRenders[index] = (rowRenders[index] ?? 0) + 1;
        };

        const {container, unmount} = render(
            <MapParent store={store} onRender={() => parentRenders++} onRowRender={onRowRender} />
        );

        expect(parentRenders).toEqual(1);

        act(() => store.setTitle(3, 'changed'));

        expect(parentRenders).toEqual(1);
        expect(rowRenders[3]).toEqual(2);
        expect(rowRenders[0]).toEqual(1);
        expect(rowRenders[1]).toEqual(1);
        expect(rowRenders[2]).toEqual(1);
        expect(rowRenders[4]).toEqual(1);
        expect(container.querySelector('.row-3')?.textContent).toEqual('changed');

        unmount();
    });

    test('a component iterating with for-of does not re-render on an unrelated write', () => {
        const store = new ListCarburetor(buildList(['a', 'b', 'c']));
        let renders = 0;

        const {container, unmount} = render(<ForOfCounter store={store} onRender={() => renders++} />);

        expect(renders).toEqual(1);
        expect(container.querySelector('.count')?.textContent).toEqual('3');

        act(() => store.bumpOther());

        expect(renders).toEqual(1);
        expect(container.querySelector('.count')?.textContent).toEqual('3');

        unmount();
    });

    test('truncating the array to zero unmounts every row with no stale content', () => {
        const store = new ListCarburetor(buildList(['a', 'b', 'c', 'd']));
        let parentRenders = 0;

        const {container, unmount} = render(
            <LoopParent store={store} onRender={() => parentRenders++} onRowRender={() => {}} />
        );

        expect(container.querySelectorAll('li').length).toEqual(4);

        act(() => store.truncate(0));

        expect(container.querySelectorAll('li').length).toEqual(0);
        expect(parentRenders).toEqual(2);

        unmount();
    });

    test('removing one row with splice shifts the rest down with no stale row', () => {
        const store = new ListCarburetor(buildList(['a', 'b', 'c', 'd']));

        const {container, unmount} = render(
            <LoopParent store={store} onRender={() => {}} onRowRender={() => {}} />
        );

        act(() => store.removeAt(1));

        const texts = Array.from(container.querySelectorAll('li')).map((li: Element) => li.textContent);

        expect(texts).toEqual(['a', 'c', 'd']);
        expect(container.querySelectorAll('li').length).toEqual(3);

        unmount();
    });

    test('sorting re-renders only the rows whose element moved, and the output order is correct', () => {
        const store = new ListCarburetor(buildList(['d', 'b', 'a', 'c']));
        const rowRenders: Record<number, number> = {};
        const onRowRender = (index: number): void => {
            rowRenders[index] = (rowRenders[index] ?? 0) + 1;
        };

        const {container, unmount} = render(
            <LoopParent store={store} onRender={() => {}} onRowRender={onRowRender} />
        );

        act(() => store.sortByTitle());

        const texts = ['row-0', 'row-1', 'row-2', 'row-3'].map(
            (className: string) => container.querySelector(`.${className}`)?.textContent
        );

        expect(texts).toEqual(['a', 'b', 'c', 'd']);
        // 'b' was already the second-smallest, so it never leaves index 1: its row must not
        // re-render. The other three all move to a different slot and must.
        expect(rowRenders[1]).toEqual(1);
        expect(rowRenders[0]).toEqual(2);
        expect(rowRenders[2]).toEqual(2);
        expect(rowRenders[3]).toEqual(2);

        unmount();
    });
});

const OWN_TAG: unique symbol = Symbol('list-render-precision/own-tag');

interface ITaggedRoot {
    tags: string[];
    user: {name: string};
    other: number;
    [OWN_TAG]?: number;
}

const getTaggedRoot = (): ITaggedRoot => ({tags: ['x', 'y'], user: {name: 'Ann'}, other: 0});

class TaggedRootCarburetor extends Carburetor<ITaggedRoot> {
    public bumpOther = (): void => {
        this.draft.other++;
        this.emitUpdate();
    };

    public tag = (value: number): void => {
        this.update((draft: ITaggedRoot): void => {
            draft[OWN_TAG] = value;
        });
    };
}

interface ITaggedProps {
    store: TaggedRootCarburetor;
    onRender: () => void;
}

class ConcatReader extends AntiHookComponent<ITaggedProps> {
    render() {
        this.props.onRender();

        const data = this.useCarburetor(this.props.store);
        const joined = data.tags.concat(['z']).join(',');

        return <span className="joined">{joined}</span>;
    }
}

class ToStringTagReader extends AntiHookComponent<ITaggedProps> {
    render() {
        this.props.onRender();

        const data = this.useCarburetor(this.props.store);
        const tag = Object.prototype.toString.call(data.user);

        return <span className="tag">{tag}</span>;
    }
}

class ToPrimitiveReader extends AntiHookComponent<ITaggedProps> {
    render() {
        this.props.onRender();

        const data = this.useCarburetor(this.props.store);
        const text = `${data.user}`.length > 0 ? 'ok' : 'empty';

        return <span className="text">{text}</span>;
    }
}

class OwnTagReader extends AntiHookComponent<ITaggedProps> {
    render() {
        this.props.onRender();

        const data = this.useCarburetor(this.props.store);

        return <span className="own-tag">{data[OWN_TAG] ?? 'none'}</span>;
    }
}

// R15-01: concat, Object.prototype.toString and String() each read a well-known symbol that
// plain data never owns (Symbol.isConcatSpreadable, Symbol.toStringTag, Symbol.toPrimitive).
// Before the fix, an absent symbol read recorded the wildcard, so any of these three in a
// render body subscribed the component to every future write, not just ones touching what it
// actually read.
describe('well-known absent symbol reads do not subscribe to the whole store (R15-01)', () => {
    test('Array.prototype.concat over a tracked array does not re-render on an unrelated write', () => {
        const store = new TaggedRootCarburetor(getTaggedRoot());
        let renders = 0;

        const {container, unmount} = render(<ConcatReader store={store} onRender={() => renders++} />);

        expect(container.querySelector('.joined')?.textContent).toEqual('x,y,z');
        expect(renders).toEqual(1);

        act(() => store.bumpOther());

        expect(renders).toEqual(1);

        unmount();
    });

    test('Object.prototype.toString.call over a tracked branch does not re-render on an unrelated write', () => {
        const store = new TaggedRootCarburetor(getTaggedRoot());
        let renders = 0;

        const {container, unmount} = render(<ToStringTagReader store={store} onRender={() => renders++} />);

        expect(container.querySelector('.tag')?.textContent).toEqual('[object Object]');
        expect(renders).toEqual(1);

        act(() => store.bumpOther());

        expect(renders).toEqual(1);

        unmount();
    });

    test('String(view) over a tracked branch does not re-render on an unrelated write', () => {
        const store = new TaggedRootCarburetor(getTaggedRoot());
        let renders = 0;

        const {container, unmount} = render(<ToPrimitiveReader store={store} onRender={() => renders++} />);

        expect(container.querySelector('.text')?.textContent).toEqual('ok');
        expect(renders).toEqual(1);

        act(() => store.bumpOther());

        expect(renders).toEqual(1);

        unmount();
    });

    test('an own symbol-keyed field still re-renders its reader when written through draft', () => {
        const store = new TaggedRootCarburetor(getTaggedRoot());
        let renders = 0;

        const {container, unmount} = render(<OwnTagReader store={store} onRender={() => renders++} />);

        expect(container.querySelector('.own-tag')?.textContent).toEqual('none');
        expect(renders).toEqual(1);

        // Nothing is recorded for the symbol key read itself (R15-01), but a write through a
        // symbol key still collapses to the wildcard on the write side, which wakes every
        // subscriber — the guarantee the fix must not break.
        act(() => store.tag(7));

        expect(container.querySelector('.own-tag')?.textContent).toEqual('7');
        expect(renders).toEqual(2);

        unmount();
    });
});

interface IKeyedRow {
    title: string;
}

interface IKeyedListData {
    items: Record<string, IKeyedRow>;
}

const buildKeyedList = (ids: string[]): IKeyedListData => ({
    items: Object.fromEntries(ids.map((id: string): [string, IKeyedRow] => [id, {title: id}])),
});

class KeyedListCarburetor extends Carburetor<IKeyedListData> {
    public setTitle = (id: string, title: string): void => {
        this.update((draft: IKeyedListData): void => {
            draft.items[id].title = title;
        });
    };

    public addItem = (id: string, row: IKeyedRow): void => {
        this.update((draft: IKeyedListData): void => {
            draft.items[id] = row;
        });
    };

    public deleteItem = (id: string): void => {
        this.update((draft: IKeyedListData): void => {
            delete draft.items[id];
        });
    };
}

interface IKeyedRowProps {
    store: KeyedListCarburetor;
    id: string;
    onRender: (id: string) => void;
}

class KeyedRow extends AntiHookComponent<IKeyedRowProps> {
    render() {
        this.props.onRender(this.props.id);

        const data = this.useCarburetor(this.props.store);

        return <li className={`row-${this.props.id}`}>{data.items[this.props.id].title}</li>;
    }
}

interface IKeyedParentProps {
    store: KeyedListCarburetor;
    onRender: () => void;
    onRowRender: (id: string) => void;
}

/** Lays out rows from Object.keys(items), the R16-01 form: an id-connected list. */
class KeyedLoopParent extends AntiHookComponent<IKeyedParentProps> {
    @bind
    private renderRow(id: string): React.ReactElement {
        return <KeyedRow key={id} store={this.props.store} id={id} onRender={this.props.onRowRender} />;
    }

    render() {
        this.props.onRender();

        const data = this.useCarburetor(this.props.store);

        return <ul>{Object.keys(data.items).map(this.renderRow)}</ul>;
    }
}

describe('a parent laying out rows from Object.keys(items) re-renders only on a key-set change (R16-01)', () => {
    test('editing one row title re-renders that row only, not the Object.keys(items) parent', () => {
        const store = new KeyedListCarburetor(buildKeyedList(['a', 'b', 'c']));
        let parentRenders = 0;
        const rowRenders: Record<string, number> = {};
        const onRowRender = (id: string): void => {
            rowRenders[id] = (rowRenders[id] ?? 0) + 1;
        };

        const {container, unmount} = render(
            <KeyedLoopParent store={store} onRender={() => parentRenders++} onRowRender={onRowRender} />
        );

        expect(parentRenders).toEqual(1);

        act(() => store.setTitle('b', 'changed'));

        // Before R16-01, the parent's Object.keys(items) read recorded 'items' itself, which a
        // write to 'items.b.title' matched through the branch index — re-rendering every row's
        // layout unnecessarily. It now records the key-set marker, untouched by a title write.
        expect(parentRenders).toEqual(1);
        expect(rowRenders.b).toEqual(2);
        expect(rowRenders.a).toEqual(1);
        expect(rowRenders.c).toEqual(1);
        expect(container.querySelector('.row-b')?.textContent).toEqual('changed');

        unmount();
    });

    test('adding a row re-renders the parent once, for the key it added; removing one does too', () => {
        const store = new KeyedListCarburetor(buildKeyedList(['a', 'b']));
        let parentRenders = 0;

        const {container, unmount} = render(
            <KeyedLoopParent store={store} onRender={() => parentRenders++} onRowRender={() => {}} />
        );

        expect(parentRenders).toEqual(1);

        act(() => store.addItem('c', {title: 'new'}));

        expect(parentRenders).toEqual(2);
        expect(container.querySelectorAll('li').length).toEqual(3);

        act(() => store.deleteItem('a'));

        expect(parentRenders).toEqual(3);
        expect(container.querySelectorAll('li').length).toEqual(2);

        unmount();
    });
});
