import {SYM, ITodoPayload, TodoCarburetor, React, act, render, AntiHookComponent} from '../support';
import {getListData, RowListCarburetor} from './support';

describe('child props boundary', () => {
        test('the snapshot is detached plain data whose identity is stable while the selection is equal', () => {
            const store = new RowListCarburetor(getListData());
            let memoRenders = 0;
            const seen: {title: string}[] = [];

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;
                seen.push(todo);

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent<{flag?: string}> {
                private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

                render() {
                    return <MemoTitle todo={this.row()} />;
                }
            }

            const {rerender, unmount} = render(<Parent />);

            rerender(<Parent flag="x" />);

            // The parent re-rendered, but the selection is equal: the child bailed on the same
            // object and never saw a second one.
            expect(memoRenders).toEqual(1);
            expect(seen.length).toEqual(1);

            const snapshot = seen[0];

            expect(Object.getPrototypeOf(snapshot)).toEqual(Object.prototype);
            expect(snapshot).not.toBe(store.getData().items.a);

            // Detached: writing the snapshot leaves the store untouched.
            snapshot.title = 'Hacked';

            expect(store.getData().items.a.title).toEqual('Ann');

            act(() => store.renameLeaf('a', 'Bob'));

            expect(memoRenders).toEqual(2);
            expect(seen.length).toEqual(2);
            expect(seen[1]).not.toBe(snapshot);
            expect(seen[1].title).toEqual('Bob');

            unmount();
        });

        // R2-07: what detaching copies is also what the comparison compares — the own
        // enumerable string and symbol properties, exactly the set a shallow spread copies.
        // Membership matters as much as value: a key swapped for another one, or a symbol
        // member whose value changed, is a content change even when the key counts match.
        test('a key replaced by another undefined-valued key at equal cardinality updates the child (R2-07)', () => {
            const store = new TodoCarburetor({payload: {a: undefined}});
            let memoRenders = 0;

            const MemoTodo = React.memo(({todo}: {todo: ITodoPayload}) => {
                memoRenders++;

                return <span className="memo-todo">{Object.keys(todo).join(',')}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly todo = this.connectSelection(() => store, (data) => ({...data.payload}));

                render() {
                    return <MemoTodo todo={this.todo()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-todo')?.textContent).toEqual('a');

            // The payload is replaced wholesale, so the parent re-renders; the key set changed
            // from {a} to {b} at equal cardinality, so the snapshot may not keep its identity.
            act(() => store.replacePayload({b: undefined}));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-todo')?.textContent).toEqual('b');

            unmount();
        });

        test('an enumerable symbol member whose value changes updates the child (R2-07)', () => {
            const store = new TodoCarburetor({payload: {[SYM]: 0}});
            let memoRenders = 0;

            const MemoTodo = React.memo(({todo}: {todo: ITodoPayload}) => {
                memoRenders++;

                return <span className="memo-sym">{todo[SYM]}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly todo = this.connectSelection(() => store, (data) => ({...data.payload}));

                render() {
                    return <MemoTodo todo={this.todo()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-sym')?.textContent).toEqual('0');

            // The spread copies the symbol member, so the child-visible content did change even
            // though the string key count stayed at zero on both sides.
            act(() => store.replacePayload({[SYM]: 1}));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-sym')?.textContent).toEqual('1');

            unmount();
        });

        test('a key removed and another added at equal cardinality updates the child (R2-07)', () => {
            const store = new TodoCarburetor({payload: {a: 1, b: 2}});
            let memoRenders = 0;

            const MemoTodo = React.memo(({todo}: {todo: ITodoPayload}) => {
                memoRenders++;

                return <span className="memo-todo">{Object.keys(todo).join(',')}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly todo = this.connectSelection(() => store, (data) => ({...data.payload}));

                render() {
                    return <MemoTodo todo={this.todo()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-todo')?.textContent).toEqual('a,b');

            act(() => store.replacePayload({a: 1, c: 2}));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-todo')?.textContent).toEqual('a,c');

            unmount();
        });

        test('an unchanged selection holding an undefined value and a symbol member keeps its identity (R2-07)', () => {
            const store = new TodoCarburetor({payload: {a: undefined, [SYM]: 0}});
            let memoRenders = 0;
            const seen: ITodoPayload[] = [];

            const MemoTodo = React.memo(({todo}: {todo: ITodoPayload}) => {
                memoRenders++;
                seen.push(todo);

                return <span className="memo-mixed">{Object.keys(todo).join(',')}</span>;
            });

            class Parent extends AntiHookComponent<{flag?: string}> {
                private readonly todo = this.connectSelection(() => store, (data) => ({...data.payload}));

                render() {
                    return <MemoTodo todo={this.todo()} />;
                }
            }

            const {container, rerender, unmount} = render(<Parent />);

            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-mixed')?.textContent).toEqual('a');

            // The parent re-renders for its own props, but the selection is unchanged: both the
            // undefined-valued key and the symbol member compare equal, so the snapshot keeps its
            // identity and the gated child keeps its bail-out.
            rerender(<Parent flag="second" />);

            expect(memoRenders).toEqual(1);
            expect(seen.length).toEqual(1);
            expect(Object.keys(seen[0])).toEqual(['a']);
            expect(seen[0][SYM]).toEqual(0);

            unmount();
        });

        test('a key order change is the same content and keeps the child bailed out (R2-07)', () => {
            const store = new TodoCarburetor({payload: {a: 1, b: 2}});
            let memoRenders = 0;
            const seen: ITodoPayload[] = [];

            const MemoTodo = React.memo(({todo}: {todo: ITodoPayload}) => {
                memoRenders++;
                seen.push(todo);

                return <span className="memo-order">{Object.keys(todo).join(',')}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly todo = this.connectSelection(() => store, (data) => ({...data.payload}));

                render() {
                    return <MemoTodo todo={this.todo()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(memoRenders).toEqual(1);

            // Same members, same values, written in the other order: the comparison is
            // set-wise, so the snapshot keeps its identity and the child never re-renders.
            act(() => store.replacePayload({b: 2, a: 1}));

            expect(memoRenders).toEqual(1);
            expect(seen.length).toEqual(1);
            expect(container.querySelector('.memo-order')?.textContent).toEqual('a,b');

            unmount();
        });

        test('a selection that is declared but never read installs no subscription', () => {
            const store = new RowListCarburetor(getListData());

            class Parent extends AntiHookComponent {
                private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

                render() {
                    return <div />;
                }
            }

            const {unmount} = render(<Parent />);

            expect(store.subscriberCount()).toEqual(0);

            unmount();
        });

});
