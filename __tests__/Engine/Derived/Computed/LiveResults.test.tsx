import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {rstest} from '@rstest/core';
import {AntiHookComponent, Carburetor, computed, shallowEqual} from '@/Carburetor';
import {READS_TRANSFER} from '@/Carburetor/Store/Paths/Markers/ReadsTransferBrand';

describe('computed', () => {
    describe('live results shared across consumers (R5-03)', () => {
        interface IUserLike {
            user: {
                name: string;
                age: number;
            };
        }

        class UserCarburetor extends Carburetor<IUserLike> {
            public setName = (name: string) => {
                this.draft.user.name = name;

                this.emitUpdate();
            };

            public setAge = (age: number) => {
                this.draft.user.age = age;

                this.emitUpdate();
            };
        }

        const getUserData = (): IUserLike => ({user: {name: 'Ada', age: 30}});

        test('the second consumer stays live for the leaf it reads (name first, age second)', () => {
            const carburetor = new UserCarburetor(getUserData());
            const currentUser = computed((read) => read(carburetor).user);

            let nameRenders = 0;
            let ageRenders = 0;
            let notified = 0;

            class NameView extends AntiHookComponent {
                render() {
                    nameRenders++;

                    return <div className="name">{this.useComputed(currentUser).name}</div>;
                }
            }

            class AgeView extends AntiHookComponent {
                render() {
                    ageRenders++;

                    return <div className="age">{this.useComputed(currentUser).age}</div>;
                }
            }

            const nameView = render(<NameView />);
            expect(nameView.container.querySelector('.name')?.textContent).toEqual('Ada');
            expect(nameRenders).toEqual(1);

            // The store registration is established by now; the age read below happens
            // through the still-live branch the body returned, after that fact.
            currentUser.subscribe(() => notified++, {id: 'listener'});

            const ageView = render(<AgeView />);
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('30');
            expect(ageRenders).toEqual(1);

            act(() => carburetor.setAge(31));

            // The late leaf read is a real dependency: the write must wake the computed,
            // deliver once, and re-render the consumer that renders the field.
            expect(notified).toEqual(1);
            expect(ageRenders).toEqual(2);
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('31');

            act(() => carburetor.setName('Grace'));

            expect(notified).toEqual(2);
            expect(nameRenders).toEqual(3);
            expect(nameView.container.querySelector('.name')?.textContent).toEqual('Grace');
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('31');

            nameView.unmount();
            ageView.unmount();
        });

        test('the second consumer stays live for the leaf it reads (age first, name second)', () => {
            const carburetor = new UserCarburetor(getUserData());
            const currentUser = computed((read) => read(carburetor).user);

            let nameRenders = 0;
            let ageRenders = 0;

            class NameView extends AntiHookComponent {
                render() {
                    nameRenders++;

                    return <div className="name">{this.useComputed(currentUser).name}</div>;
                }
            }

            class AgeView extends AntiHookComponent {
                render() {
                    ageRenders++;

                    return <div className="age">{this.useComputed(currentUser).age}</div>;
                }
            }

            const ageView = render(<AgeView />);
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('30');
            expect(ageRenders).toEqual(1);

            const nameView = render(<NameView />);
            expect(nameView.container.querySelector('.name')?.textContent).toEqual('Ada');
            expect(nameRenders).toEqual(1);

            act(() => carburetor.setName('Grace'));

            // The name read above happened after the age reader established the
            // registration; the write must still reach the consumer that renders it.
            expect(nameRenders).toEqual(2);
            expect(nameView.container.querySelector('.name')?.textContent).toEqual('Grace');
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('30');

            act(() => carburetor.setAge(31));

            expect(ageRenders).toEqual(3);
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('31');

            nameView.unmount();
            ageView.unmount();
        });

        test('a single consumer keeps updating on the field it reads (control)', () => {
            const carburetor = new UserCarburetor(getUserData());
            const currentUser = computed((read) => read(carburetor).user);

            let renders = 0;

            class NameView extends AntiHookComponent {
                render() {
                    renders++;

                    return <div className="name">{this.useComputed(currentUser).name}</div>;
                }
            }

            const view = render(<NameView />);
            expect(view.container.querySelector('.name')?.textContent).toEqual('Ada');
            expect(renders).toEqual(1);

            // A field nobody read must not wake the computed: the amendment stays precise.
            act(() => carburetor.setAge(31));
            expect(renders).toEqual(1);
            expect(view.container.querySelector('.name')?.textContent).toEqual('Ada');

            act(() => carburetor.setName('Grace'));
            expect(renders).toEqual(2);
            expect(view.container.querySelector('.name')?.textContent).toEqual('Grace');

            view.unmount();
        });
    });

    describe('a live list of rows amends its dependency without re-subscribing what was already read', () => {
        interface IRow {
            title: string;
        }

        interface IRowListData {
            items: Record<number, IRow>;
        }

        class RowListCarburetor extends Carburetor<IRowListData> {
            public setTitle = (index: number, title: string) => {
                this.draft.items[index].title = title;

                this.emitUpdate();
            };
        }

        const ROWS = 2000;

        const getRowListData = (): IRowListData => ({
            items: Object.fromEntries(
                Array.from({length: ROWS}, (_, index: number) => [index, {title: 'row-' + index}])
            ),
        });

        test('adding a key beneath an unread row does not wake a live computed (R33-01)', () => {
            const carburetor = new RowListCarburetor(getRowListData());
            const rows = computed(read => read(carburetor).items);
            let notified = 0;
            rows.subscribe(() => {
                void rows.get()[5].title;
                notified++;
            }, {id: 'listener'});

            carburetor.update((draft) => {
                (draft.items[6] as IRow & {extra?: string}).extra = 'new';
            });

            expect(notified).toEqual(0);
        });

        test('one edit through a 2000-row computed subscribes a bounded number of times (R16-08)', () => {
            const carburetor = new RowListCarburetor(getRowListData());
            const rows = computed((read) => read(carburetor).items);
            const subscribeSpy = rstest.spyOn(carburetor, 'subscribe');

            let renders = 0;

            class RowsView extends AntiHookComponent {
                render() {
                    renders++;

                    const items = this.useComputed(rows);
                    let text = '';

                    for (const row of Object.values(items)) {
                        text += row.title + '|';
                    }

                    return <div>{text}</div>;
                }
            }

            const view = render(<RowsView />);
            expect(renders).toEqual(1);
            expect(view.container.textContent).toContain('row-5|');

            const callsAtMount = subscribeSpy.mock.calls.length;

            act(() => carburetor.setTitle(5, 'edited-5'));

            // Every leaf a render already read amends the live dependency in place; only the
            // one recompute that follows re-subscribes the store, however many rows a render
            // touches. Pre-fix this scales with row count (two subscribe calls per row).
            const callsForOneEdit = subscribeSpy.mock.calls.length - callsAtMount;

            expect(callsForOneEdit).toBeLessThan(10);
            expect(renders).toEqual(2);
            expect(view.container.textContent).toContain('edited-5');
            expect(view.container.textContent).not.toContain('row-5|');

            act(() => carburetor.setTitle(1500, 'edited-1500'));

            expect(renders).toEqual(3);
            expect(view.container.textContent).toContain('edited-1500');
            expect(view.container.textContent).toContain('edited-5');

            view.unmount();
            subscribeSpy.mockRestore();
        });
    });

    describe('a dependency subscription transfers its read set instead of copying it', () => {
        interface IBoxLike {
            value: {n: number};
        }

        class BoxCarburetor extends Carburetor<IBoxLike> {
            public setN = (n: number) => {
                this.draft.value.n = n;
                this.emitUpdate();
            };
        }

        test('a leaf read through the live result, after publication, still wakes the computed', () => {
            const carburetor = new BoxCarburetor({value: {n: 1}});
            const boxed = computed((read) => read(carburetor).value);
            let notified = 0;

            // Observing runs the body once: it reads only `value` itself, not `value.n` — the
            // subscription this establishes is `transferReads()` handing the computed's own
            // dependency.reads Set to `subscribe()` directly (no copy), which is what makes the
            // read below able to widen that very same Set through Carburetor.extend rather than
            // a copy of it.
            boxed.subscribe(() => notified++, {id: 'listener'});

            // A leaf read through the still-live result, after the body already returned —
            // exactly what a consumer rendering `boxed.get().n` does. It amends the dependency
            // through extend(), which must still register despite the Set having been adopted,
            // not copied, and already carrying the path by the time extend() is asked about it.
            expect(boxed.get().n).toEqual(1);

            carburetor.setN(2);

            expect(notified).toEqual(1);
            expect(boxed.get().n).toEqual(2);
        });

        test('subscribes to its dependency through transferReads(), not a copied read set (R6-04)', () => {
            const carburetor = new BoxCarburetor({value: {n: 1}});
            const boxed = computed((read) => read(carburetor).value);
            const subscribeSpy = rstest.spyOn(carburetor, 'subscribe');

            boxed.subscribe(() => undefined, {id: 'listener'});

            const options = subscribeSpy.mock.calls[0][1] as {reads?: unknown; [READS_TRANSFER]?: unknown};

            expect(options[READS_TRANSFER]).toBe(options.reads);

            subscribeSpy.mockRestore();
        });
    });

    describe('a recompute reading the same paths keeps its registration, a moved one replaces it (R16-08)', () => {
        interface ITodoLike {
            items: {[id: string]: {title: string; done: boolean}};
        }

        class TodoCarburetor extends Carburetor<ITodoLike> {
            public setTitle = (id: string, title: string) => {
                this.draft.items[id].title = title;

                this.emitUpdate();
            };

            public setDone = (id: string, done: boolean) => {
                this.draft.items[id].done = done;

                this.emitUpdate();
            };
        }

        test('an unchanged read set does not call subscribe again; a branch flip does, once', () => {
            const initial = {items: {a: {title: 'a', done: false}, b: {title: 'b', done: false}}};
            const carburetor = new TodoCarburetor(initial);
            const label = computed((read) => {
                const data = read(carburetor);

                return data.items.a.done ? data.items.a.title : data.items.b.title;
            });

            const subscribeSpy = rstest.spyOn(carburetor, 'subscribe');

            label.subscribe(() => undefined, {id: 'listener'});
            expect(subscribeSpy.mock.calls.length).toEqual(1);

            // Still reads items.a.done and items.b.title: the set did not move, so the kept
            // edge stays subscribed as-is — no second registration for this write.
            carburetor.setTitle('b', 'renamed-b');
            expect(label.get()).toEqual('renamed-b');
            expect(subscribeSpy.mock.calls.length).toEqual(1);

            // Flips the branch: now reads items.a.done and items.a.title instead of
            // items.b.title — a genuinely different set, so the edge re-registers once.
            carburetor.setDone('a', true);
            expect(label.get()).toEqual('a');
            expect(subscribeSpy.mock.calls.length).toEqual(2);

            subscribeSpy.mockRestore();
        });
    });

    describe('the development diagnostic reports a live result escaping through props (R15-02)', () => {
        interface IRow {
            title: string;
        }

        interface IRowListData {
            items: IRow[];
        }

        class RowListCarburetor extends Carburetor<IRowListData> {
            public setTitle = (index: number, title: string) => {
                this.draft.items[index].title = title;

                this.emitUpdate();
            };
        }

        const getRowListData = (): IRowListData => ({
            items: [{title: 'a'}, {title: 'b'}, {title: 'c'}],
        });

        /** Runs `body` with `console.error` captured instead of printed, and returns what it logged. */
        const withCapturedConsoleError = (body: () => void): string[] => {
            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                body();
            } finally {
                console.error = original;
            }

            return reported;
        };

        test('a row rendering a computed result received through props reports the escape once', () => {
            const carburetor = new RowListCarburetor(getRowListData());
            const rows = computed((read) => read(carburetor).items);

            class Row extends AntiHookComponent<{todo: IRow}> {
                render() {
                    return <span className="row">{this.props.todo.title}</span>;
                }
            }

            class RowsView extends AntiHookComponent {
                render() {
                    const items = this.useComputed(rows);

                    return <div>{items.map((item: IRow, index: number) => <Row key={index} todo={item} />)}</div>;
                }
            }

            const reported = withCapturedConsoleError(() => {
                const view = render(<RowsView />);

                // A second render exercises the same escape again — the report must not repeat.
                act(() => carburetor.setTitle(0, 'renamed'));

                view.unmount();
            });

            expect(reported.length).toEqual(1);
            expect(reported[0]).toContain("live result");
        });

        test('a component reading its own useComputed() result in its own render never reports (control)', () => {
            const carburetor = new RowListCarburetor(getRowListData());
            const rows = computed((read) => read(carburetor).items);

            class OwnReaderView extends AntiHookComponent {
                render() {
                    const items = this.useComputed(rows);

                    return <div>{items.map((item: IRow) => item.title).join(',')}</div>;
                }
            }

            const reported = withCapturedConsoleError(() => {
                const view = render(<OwnReaderView />);

                act(() => carburetor.setTitle(0, 'renamed'));

                view.unmount();
            });

            expect(reported).toEqual([]);
        });

        test('the diagnostic is skipped in production', () => {
            const carburetor = new RowListCarburetor(getRowListData());
            const rows = computed((read) => read(carburetor).items);

            class Row extends AntiHookComponent<{todo: IRow}> {
                render() {
                    return <span>{this.props.todo.title}</span>;
                }
            }

            class RowsView extends AntiHookComponent {
                render() {
                    const items = this.useComputed(rows);

                    return <div>{items.map((item: IRow, index: number) => <Row key={index} todo={item} />)}</div>;
                }
            }

            const originalEnv = process.env.NODE_ENV;
            let reported: string[] = [];

            try {
                process.env.NODE_ENV = 'production';

                reported = withCapturedConsoleError(() => {
                    const view = render(<RowsView />);

                    view.unmount();
                });
            } finally {
                process.env.NODE_ENV = originalEnv;
            }

            expect(reported).toEqual([]);
        });
    });

    describe('computed(body, {equals}) skips the list re-render for an unchanged result (R15-03)', () => {
        interface IRow {
            title: string;
            done: boolean;
        }

        interface IRowListData {
            items: IRow[];
        }

        class RowListCarburetor extends Carburetor<IRowListData> {
            /**
             * Touches `done` twice, ending at the value it started with: the field a reader
             * depends on is recorded as written, while its value nets to no change. Replacing
             * the whole record with an equal one no longer serves this purpose since R16-03: the
             * write proxy diffs a same-kind replacement and records nothing when nothing in it
             * actually differs, which is precisely the case this describe block used to exploit.
             */
            public toggleDoneAndBack = (index: number) => {
                this.update((draft: IRowListData) => {
                    draft.items[index].done = !draft.items[index].done;
                    draft.items[index].done = !draft.items[index].done;
                });
            };
        }

        const getRowListData = (): IRowListData => ({
            items: [{title: 'a', done: false}, {title: 'b', done: true}, {title: 'c', done: false}],
        });

        /** One `ListView` reading a `visibleTitles` computed built with or without `{equals}`. */
        const buildView = (useEquals: boolean) => {
            const carburetor = new RowListCarburetor(getRowListData());
            const visibleTitles = computed<string[]>(
                (read) => read(carburetor).items.filter((item: IRow) => !item.done).map((item: IRow) => item.title),
                useEquals ? {equals: shallowEqual} : undefined
            );
            let renders = 0;

            class ListView extends AntiHookComponent {
                render() {
                    renders++;

                    return <div>{this.useComputed(visibleTitles).join(',')}</div>;
                }
            }

            const view = render(<ListView />);

            return {carburetor, view, getRenders: (): number => renders};
        };

        test('a write that recomputes to the same visible titles causes 0 re-renders', () => {
            const {carburetor, view, getRenders} = buildView(true);

            expect(getRenders()).toEqual(1);

            // A fresh reference every recompute (`filter`/`map` never return the same array), so
            // only content equality — not identity — can suppress this announce.
            act(() => carburetor.toggleDoneAndBack(1));

            expect(getRenders()).toEqual(1);

            view.unmount();
        });

        test('the same write causes 1 re-render without {equals} (control)', () => {
            const {carburetor, view, getRenders} = buildView(false);

            expect(getRenders()).toEqual(1);

            act(() => carburetor.toggleDoneAndBack(1));

            expect(getRenders()).toEqual(2);

            view.unmount();
        });
    });
});
