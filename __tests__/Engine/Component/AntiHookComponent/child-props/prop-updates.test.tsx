import {React, act, render, AntiHookComponent} from '../support';
import {getListData, RowListCarburetor} from './support';

describe('child props boundary', () => {
        test('reproduction: the Ann → Bob memo child displays Bob through the selection snapshot', () => {
            const store = new RowListCarburetor(getListData());
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

                render() {
                    return <MemoTitle todo={this.row()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-title')?.textContent).toEqual('Ann');

            // The in-place leaf write — the exact write that stranded the live-view child.
            act(() => store.renameLeaf('a', 'Bob'));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Bob');

            unmount();
        });

        test('a class child gated by its own props gate re-renders when the snapshot changes', () => {
            const store = new RowListCarburetor(getListData());
            let childRenders = 0;

            class GatedChild extends AntiHookComponent<{todo: {title: string}}> {
                render() {
                    childRenders++;

                    return <span className="gated-title">{this.props.todo.title}</span>;
                }
            }

            class Parent extends AntiHookComponent {
                private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

                render() {
                    return <GatedChild todo={this.row()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(container.querySelector('.gated-title')?.textContent).toEqual('Ann');
            expect(childRenders).toEqual(1);

            act(() => store.renameLeaf('a', 'Bob'));

            expect(childRenders).toEqual(2);
            expect(container.querySelector('.gated-title')?.textContent).toEqual('Bob');

            unmount();
        });

        test('an unrelated store write does not redraw the child', () => {
            const store = new RowListCarburetor(getListData());
            let parentRenders = 0;
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent<{flag?: string}> {
                private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

                render() {
                    parentRenders++;

                    return <MemoTitle todo={this.row()} />;
                }
            }

            const {container, rerender, unmount} = render(<Parent />);

            expect(memoRenders).toEqual(1);

            // The selection reads items.a.title only, so a write to another row wakes nobody.
            act(() => store.renameLeaf('b', 'Belle'));

            expect(parentRenders).toEqual(1);
            expect(memoRenders).toEqual(1);

            // The parent re-renders for its own props, but the selection is equal: the snapshot
            // keeps its identity and the memo child keeps its bail-out.
            rerender(<Parent flag="second" />);

            expect(parentRenders).toEqual(2);
            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Ann');

            unmount();
        });

        test('a bail-out does not remove the dependencies the next update needs', () => {
            const store = new RowListCarburetor(getListData());
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent<{flag?: string}> {
                private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

                render() {
                    return <MemoTitle todo={this.row()} />;
                }
            }

            const {container, rerender, unmount} = render(<Parent />);

            // Two bail-outs in a row: the selector still runs on each, which is what keeps the
            // subscription for items.a.title alive across renders nobody draws.
            rerender(<Parent flag="two" />);
            rerender(<Parent flag="three" />);

            expect(memoRenders).toEqual(1);

            act(() => store.renameLeaf('a', 'Bob'));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Bob');

            unmount();
        });

        test('replacing a nested object still updates the child', () => {
            const store = new RowListCarburetor(getListData());
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

                render() {
                    return <MemoTitle todo={this.row()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            // The wholesale row replacement — the write a handed-down live branch does see.
            act(() => store.rename('a', 'Bob'));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Bob');

            unmount();
        });

        test('replacing the whole store still updates the child', () => {
            const store = new RowListCarburetor(getListData());
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

                render() {
                    return <MemoTitle todo={this.row()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            // A block body: setData returns the new data, and a value-returning callback puts
            // act() on its Promise overload.
            act(() => {
                store.setData({items: {a: {title: 'Carol', done: false}, b: {title: 'Bea', done: false}}});
            });

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Carol');

            unmount();
        });

        test('a swapped source re-points the selection at the new store', () => {
            const first = new RowListCarburetor(getListData());
            const second = new RowListCarburetor({items: {a: {title: 'Cara', done: false}}});

            class Parent extends AntiHookComponent<{store: RowListCarburetor}> {
                private readonly row = this.connectSelection(
                    () => this.props.store,
                    (data) => ({title: data.items.a.title})
                );

                render() {
                    return <span className="swap-title">{this.row().title}</span>;
                }
            }

            const {container, rerender, unmount} = render(<Parent store={first} />);

            expect(container.querySelector('.swap-title')?.textContent).toEqual('Ann');

            rerender(<Parent store={second} />);

            expect(container.querySelector('.swap-title')?.textContent).toEqual('Cara');
            expect(first.subscriberCount()).toEqual(0);
            expect(second.subscriberCount()).toEqual(1);

            unmount();

            expect(second.subscriberCount()).toEqual(0);
        });

});
