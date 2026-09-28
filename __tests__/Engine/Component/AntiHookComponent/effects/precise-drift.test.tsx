import {React, render, AntiHookComponent, Carburetor} from '../support';

// R16-05: the commit-time drift check used to compare only the store's version, so any write
// landing between a component's render and its commit cost it a second render, whatever path
// that write touched. These tests pin the path-precise replacement: each scenario below is a
// regression proven to fail on the pre-fix code (see the PR notes for the revert-and-run check).

interface IRowsData {
    items: {[id: string]: {title: string}};
    sizes: {[id: string]: number};
    other: number;
}

const makeRowsData = (rows: number): IRowsData => {
    const items: IRowsData['items'] = {};

    for (let i = 0; i < rows; i++) {
        items[String(i)] = {title: 'row' + i};
    }

    return {items, sizes: {}, other: 0};
};

class RowsCarburetor extends Carburetor<IRowsData> {
    public writeOther = (): void => {
        this.draft.other++;
        this.emitUpdate();
    };

    public writeSize = (id: string, size: number): void => {
        this.draft.sizes[id] = size;
        this.emitUpdate();
    };

    public writeTitle = (id: string, title: string): void => {
        this.draft.items[id].title = title;
        this.emitUpdate();
    };

    public replaceItem = (id: string, title: string): void => {
        this.draft.items[id] = {title};
        this.emitUpdate();
    };

    public markAll = (): void => {
        this.markAllChanged();
        this.emitUpdate();
    };
}

describe('precise commit drift check (R16-05)', () => {
    test('N rows plus an earlier sibling writing an unrelated path on mount each render once', () => {
        const rowCount = 20;
        const store = new RowsCarburetor(makeRowsData(rowCount));
        const counters: Record<string, number> = {};

        class Early extends AntiHookComponent {
            protected useEffects(): void {
                store.writeOther();
            }

            render() {
                return <div/>;
            }
        }

        class Row extends AntiHookComponent<{id: string}> {
            render() {
                counters[this.props.id] = (counters[this.props.id] ?? 0) + 1;
                const data = this.useCarburetor(store);

                return <li>{data.items[this.props.id].title}</li>;
            }
        }

        class Rows extends AntiHookComponent {
            render() {
                const ids = Object.keys(this.useCarburetor(store).items);

                return <ul>{ids.map((id) => <Row key={id} id={id}/>)}</ul>;
            }
        }

        const {unmount} = render(<div><Early/><Rows/></div>);

        for (let i = 0; i < rowCount; i++) {
            expect(counters[String(i)]).toEqual(1);
        }

        unmount();
    });

    test('every row writing its own size on mount, never reading sizes, renders once each', () => {
        const rowCount = 20;
        const store = new RowsCarburetor(makeRowsData(rowCount));
        const counters: Record<string, number> = {};

        class Row extends AntiHookComponent<{id: string}> {
            protected useEffects(): void {
                store.writeSize(this.props.id, 1);
            }

            render() {
                counters[this.props.id] = (counters[this.props.id] ?? 0) + 1;
                const data = this.useCarburetor(store);

                return <li>{data.items[this.props.id].title}</li>;
            }
        }

        class Rows extends AntiHookComponent {
            render() {
                const ids = Object.keys(this.useCarburetor(store).items);

                return <ul>{ids.map((id) => <Row key={id} id={id}/>)}</ul>;
            }
        }

        const {unmount} = render(<Rows/>);

        for (let i = 0; i < rowCount; i++) {
            expect(counters[String(i)]).toEqual(1);
        }

        unmount();
    });

    test('a write to the exact path a row read, landing between render and commit, still re-renders it', () => {
        const store = new RowsCarburetor(makeRowsData(1));
        let renders = 0;

        class Early extends AntiHookComponent {
            protected useEffects(): void {
                store.writeTitle('0', 'changed');
            }

            render() {
                return <div/>;
            }
        }

        class Reader extends AntiHookComponent {
            render() {
                renders++;
                const data = this.useCarburetor(store);

                return <div className="value">{data.items['0'].title}</div>;
            }
        }

        const {container, unmount} = render(<div><Early/><Reader/></div>);

        expect(renders).toEqual(2);
        expect(container.querySelector('.value')?.textContent).toEqual('changed');

        unmount();
    });

    test('a write to an ancestor of a read path also re-renders it', () => {
        const store = new RowsCarburetor(makeRowsData(1));
        let renders = 0;

        class Early extends AntiHookComponent {
            protected useEffects(): void {
                // Replaces the whole items.0 branch: an ancestor of the leaf the reader read.
                store.replaceItem('0', 'changed');
            }

            render() {
                return <div/>;
            }
        }

        class Reader extends AntiHookComponent {
            render() {
                renders++;
                const data = this.useCarburetor(store);

                return <div className="value">{data.items['0'].title}</div>;
            }
        }

        const {container, unmount} = render(<div><Early/><Reader/></div>);

        expect(renders).toEqual(2);
        expect(container.querySelector('.value')?.textContent).toEqual('changed');

        unmount();
    });

    // The "written descendant of a read path" case is pinned in writeLog.test.ts: since R16-01 a
    // tracked render records markers (~p, ~k) and leaves, never a bare branch a leaf write could
    // sit below. Here: the key-set marker an enumeration records, through the drift check.
    test('a key added under an enumerated branch re-renders it', () => {
        const store = new RowsCarburetor(makeRowsData(1));
        let renders = 0;

        class Early extends AntiHookComponent {
            protected useEffects(): void {
                store.replaceItem('1', 'added');
            }

            render() {
                return <div/>;
            }
        }

        class Reader extends AntiHookComponent {
            render() {
                renders++;
                const data = this.useCarburetor(store);

                return <div>{Object.keys(data.items).length}</div>;
            }
        }

        const {unmount} = render(<div><Early/><Reader/></div>);

        expect(renders).toEqual(2);

        unmount();
    });

    test('a value write below an enumerated branch does not re-render it', () => {
        const store = new RowsCarburetor(makeRowsData(1));
        let renders = 0;

        class Early extends AntiHookComponent {
            protected useEffects(): void {
                store.writeTitle('0', 'changed');
            }

            render() {
                return <div/>;
            }
        }

        class Reader extends AntiHookComponent {
            render() {
                renders++;
                const data = this.useCarburetor(store);

                return <div>{Object.keys(data.items).length}</div>;
            }
        }

        const {unmount} = render(<div><Early/><Reader/></div>);

        expect(renders).toEqual(1);

        unmount();
    });

    test('a write log overflow falls back to a re-render even for an unrelated write', () => {
        const store = new RowsCarburetor(makeRowsData(1));
        let renders = 0;

        class Early extends AntiHookComponent {
            protected useEffects(): void {
                // Overflows the log's default capacity with writes to an entirely unrelated
                // path, pushing the watermark past Reader's baseline: past that point the log
                // cannot answer precisely, so the safety net force-updates regardless of what
                // was actually written.
                for (let i = 0; i < 4200; i++) {
                    store.writeOther();
                }
            }

            render() {
                return <div/>;
            }
        }

        class Reader extends AntiHookComponent {
            render() {
                renders++;
                const data = this.useCarburetor(store);

                return <div>{data.items['0'].title}</div>;
            }
        }

        const {unmount} = render(<div><Early/><Reader/></div>);

        expect(renders).toEqual(2);

        unmount();
    });

    test('a wildcard write landing between render and commit re-renders', () => {
        const store = new RowsCarburetor(makeRowsData(1));
        let renders = 0;

        class Early extends AntiHookComponent {
            protected useEffects(): void {
                store.markAll();
            }

            render() {
                return <div/>;
            }
        }

        class Reader extends AntiHookComponent {
            render() {
                renders++;
                const data = this.useCarburetor(store);

                return <div>{data.items['0'].title}</div>;
            }
        }

        const {unmount} = render(<div><Early/><Reader/></div>);

        expect(renders).toEqual(2);

        unmount();
    });

    test('an unrelated write between render and commit does not re-render the reader', () => {
        const store = new RowsCarburetor(makeRowsData(2));
        let renders = 0;

        class Early extends AntiHookComponent {
            protected useEffects(): void {
                store.writeTitle('1', 'other-row-changed');
            }

            render() {
                return <div/>;
            }
        }

        class Reader extends AntiHookComponent {
            render() {
                renders++;
                const data = this.useCarburetor(store);

                return <div className="value">{data.items['0'].title}</div>;
            }
        }

        const {container, unmount} = render(<div><Early/><Reader/></div>);

        expect(renders).toEqual(1);
        expect(container.querySelector('.value')?.textContent).toEqual('row0');

        unmount();
    });
});
