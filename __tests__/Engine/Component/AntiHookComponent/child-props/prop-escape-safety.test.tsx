import {React, act, render, AntiHookComponent} from '../support';
import {getListData, RowListCarburetor} from './support';

describe('child props boundary', () => {
        test('a selection that stops being read is dropped and restored like a connection', () => {
            const store = new RowListCarburetor(getListData());
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent<{show: boolean}> {
                private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

                render() {
                    return this.props.show ? <MemoTitle todo={this.row()} /> : <span className="hidden">off</span>;
                }
            }

            const {container, rerender, unmount} = render(<Parent show />);

            expect(store.subscriberCount()).toEqual(1);

            rerender(<Parent show={false} />);

            expect(store.subscriberCount()).toEqual(0);

            // The write nobody reads must not redraw the hidden child.
            act(() => store.renameLeaf('a', 'Bob'));

            expect(memoRenders).toEqual(1);

            rerender(<Parent show />);

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Bob');
            expect(store.subscriberCount()).toEqual(1);

            unmount();
        });

        test('a selection handing out a live view is reported once in development', () => {
            const store = new RowListCarburetor(getListData());

            class Parent extends AntiHookComponent {
                private readonly row = this.connectSelection(() => store, (data) => ({row: data.items.a}));

                render() {
                    return <span className="live-branch">{this.row().row.title}</span>;
                }
            }

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const view = render(<Parent />);

                view.rerender(<Parent />);
                view.unmount();
            } finally {
                console.error = original;
            }

            // Once per selection, not per render: the mistake is the declaration's.
            expect(reported.filter((message) => message.includes('connectSelection()')).length).toEqual(1);
        });

        // The two tests below pin the documented unsupported escape — see README — for which
        // connectSelection is the supported transfer: a live view handed to a gated child fails
        // silently, and these assert the stale outcome rather than a fix.
        test('unsupported escape: a memo child receiving the live branch keeps stale data after a leaf write', () => {
            const store = new RowListCarburetor(getListData());
            let parentRenders = 0;
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly list = this.connect(() => store);

                render() {
                    parentRenders++;

                    // The parent reads the branch but no leaf, so it subscribes to the branch
                    // marker alone; the child's own reads happen outside the parent's render
                    // attempt and record nothing.
                    return <MemoTitle todo={this.list.items.a} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            act(() => store.renameLeaf('a', 'Bob'));

            expect(parentRenders).toEqual(1);
            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Ann');
            expect(store.getData().items.a.title).toEqual('Bob');

            unmount();
        });

        test('unsupported escape: the props gate bails even when the parent re-renders on the same leaf', () => {
            const store = new RowListCarburetor(getListData());
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly list = this.connect(() => store);

                render() {
                    return <div>
                        <span className="heading">{this.list.items.a.title}</span>
                        <MemoTitle todo={this.list.items.a} />
                    </div>;
                }
            }

            const {container, unmount} = render(<Parent />);

            act(() => store.renameLeaf('a', 'Bob'));

            // The parent is live on the leaf and redraws it, but the leaf write did not change
            // the branch object's identity, so the memo child bails and keeps its first render.
            expect(container.querySelector('.heading')?.textContent).toEqual('Bob');
            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Ann');

            unmount();
        });

        test('the selection data is deeply read-only and the snapshot type is inferred', () => {
            const store = new RowListCarburetor(getListData());

            class TypedParent extends AntiHookComponent {
                private readonly row = this.connectSelection(
                    () => store,
                    (data) => ({
                        title: data.items.a.title,
                        done: data.items.a.done,
                        upper: data.items.a.title.length > 0
                    })
                );

                // Pins the inferred snapshot type: no casts, no field lists.
                public peek(): {title: string; done: boolean; upper: boolean} {
                    const view = this.row();

                    return {title: view.title, done: view.done, upper: view.upper};
                }

                render() {
                    return <span className="typed">{this.row().title}</span>;
                }
            }

            const {container, unmount} = render(<TypedParent />);

            expect(container.querySelector('.typed')?.textContent).toEqual('Ann');

            // Construction outside React is legal, and the snapshot type still infers.
            const holder = new TypedParent({} as never);

            expect(holder.peek()).toEqual({title: 'Ann', done: false, upper: true});

            unmount();
        });
});
