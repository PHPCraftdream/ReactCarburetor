import {React, act, render, AntiHookComponent, Carburetor} from '../support';

/** An Array subclass with native private state — the review's repro shape (R12-01). */
class TaggedList<T> extends Array<T> {
    #tag: number;

    public constructor(tag: number, ...items: T[]) {
        // super(...items) risks the Array(n) single-number-length trap; push() avoids it.
        super();
        this.push(...items);
        this.#tag = tag;
    }

    public tag(): number {
        return this.#tag;
    }
}

interface IListData {
    rows: number[];
}

class RowsCarburetor extends Carburetor<IListData> {
    public setRows = (rows: number[]): void => {
        this.update((draft: IListData): void => {
            draft.rows = rows;
        });
    };
}

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {message?: string}> {
    public state: {message?: string} = {};

    public static getDerivedStateFromError(error: Error): {message: string} {
        return {message: error.message};
    }

    public render(): React.ReactNode {
        return this.state.message === undefined
            ? this.props.children
            : <span className="selection-error">{this.state.message}</span>;
    }
}

describe('connectSelection Array-subclass boundary (R12-01)', () => {
    test('a rendered selection returning an Array subclass fails with an actionable error instead of ' +
        'forging it — a child calling the subclass method never runs', () => {
        const store = new RowsCarburetor({rows: [1, 2, 3]});
        let tagCalls = 0;

        class Parent extends AntiHookComponent {
            private readonly selected = this.connectSelection(
                () => store,
                (data) => new TaggedList(7, ...data.rows)
            );

            render() {
                const list = this.selected() as TaggedList<number>;

                tagCalls++;

                return <span className="tag">{list.tag()}</span>;
            }
        }

        const originalError = console.error;

        console.error = () => undefined;

        try {
            const {container, unmount} = render(<ErrorBoundary><Parent /></ErrorBoundary>);
            const message = container.querySelector('.selection-error')?.textContent;

            expect(message).toContain('Array subclass');
            expect(message).toContain('TaggedList');
            expect(message).toContain('Array.from');
            // The render threw before the child's own render body could call the brand-checked method.
            expect(tagCalls).toEqual(0);

            unmount();
        } finally {
            console.error = originalError;
        }
    });

    test('an Array subclass nested inside a plain selection is rejected at its own depth (R12-01)', () => {
        const store = new RowsCarburetor({rows: [1, 2, 3]});

        class Parent extends AntiHookComponent {
            private readonly selected = this.connectSelection(
                () => store,
                (data) => ({wrapper: {rows: new TaggedList(9, ...data.rows)}})
            );

            render() {
                return <span>{JSON.stringify(this.selected())}</span>;
            }
        }

        const originalError = console.error;

        console.error = () => undefined;

        try {
            const {container, unmount} = render(<ErrorBoundary><Parent /></ErrorBoundary>);
            const message = container.querySelector('.selection-error')?.textContent;

            expect(message).toContain('Array subclass');
            expect(message).toContain('TaggedList');

            unmount();
        } finally {
            console.error = originalError;
        }
    });

    test('a plain array selection still detaches and re-renders a memo child (control)', () => {
        const store = new RowsCarburetor({rows: [1, 2, 3]});
        let memoRenders = 0;

        const MemoRows = React.memo(({rows}: {rows: number[]}) => {
            memoRenders++;

            return <span className="memo-rows">{rows.join(',')}</span>;
        });

        class Parent extends AntiHookComponent {
            private readonly selected = this.connectSelection(() => store, (data) => data.rows.slice());

            render() {
                return <MemoRows rows={this.selected()} />;
            }
        }

        const {container, unmount} = render(<Parent />);

        expect(container.querySelector('.memo-rows')?.textContent).toEqual('1,2,3');
        expect(memoRenders).toEqual(1);

        // Same content: the snapshot keeps its identity and the memo child keeps its bail-out.
        act(() => store.setRows([1, 2, 3]));

        expect(memoRenders).toEqual(1);

        act(() => store.setRows([4, 5]));

        expect(memoRenders).toEqual(2);
        expect(container.querySelector('.memo-rows')?.textContent).toEqual('4,5');

        unmount();
    });

    test('a sparse array selection preserves its true length and skips holes (control)', () => {
        const store = new RowsCarburetor({rows: [1, 2, 3]});

        class Parent extends AntiHookComponent {
            public readonly selected = this.connectSelection(() => store, () => {
                const sparse: unknown[] = [];

                sparse[2] = 'x';

                return sparse;
            });
        }

        const instance = new Parent({} as never);
        const first = instance.selected();

        expect(first.length).toEqual(3);
        expect(Object.keys(first)).toEqual(['2']);
        expect(0 in first).toEqual(false);
        expect(Object.getPrototypeOf(first)).toBe(Array.prototype);
    });

    test('an array with a symbol key and a non-enumerable member is copied as currently supported (control)', () => {
        const store = new RowsCarburetor({rows: [1, 2, 3]});
        const TAG = Symbol('array-tag');

        class Parent extends AntiHookComponent {
            public readonly selected = this.connectSelection(() => store, (data) => {
                const copy: number[] = data.rows.slice();

                Object.defineProperty(copy, TAG, {value: 'meta', enumerable: true, configurable: true});
                Object.defineProperty(copy, 'hidden', {value: 99, enumerable: false, configurable: true});

                return copy;
            });
        }

        const instance = new Parent({} as never);
        const first = instance.selected() as unknown[] & {hidden?: number; [TAG]?: string};

        expect(Array.from(first)).toEqual([1, 2, 3]);
        expect(first[TAG]).toEqual('meta');
        expect(first.hidden).toEqual(99);
        expect(Object.getOwnPropertyDescriptor(first, 'hidden')?.enumerable).toEqual(false);
    });

    test('a null-prototype array selection is copied and keeps its null prototype (control)', () => {
        const store = new RowsCarburetor({rows: [1, 2, 3]});

        class Parent extends AntiHookComponent {
            public readonly selected = this.connectSelection(() => store, (data) => {
                const nullProtoArray: number[] = Object.setPrototypeOf(data.rows.slice(), null);

                return nullProtoArray;
            });
        }

        const instance = new Parent({} as never);
        const first = instance.selected();

        expect(Object.getPrototypeOf(first)).toBeNull();
        expect(Array.from(first)).toEqual([1, 2, 3]);
    });
});
