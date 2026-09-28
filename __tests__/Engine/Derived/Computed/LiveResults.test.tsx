import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {rstest} from '@rstest/core';
import {AntiHookComponent, Carburetor, computed} from '@/Carburetor';

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
            items: IRow[];
        }

        class RowListCarburetor extends Carburetor<IRowListData> {
            public setTitle = (index: number, title: string) => {
                this.draft.items[index].title = title;

                this.emitUpdate();
            };
        }

        const ROWS = 2000;

        const getRowListData = (): IRowListData => ({
            items: Array.from({length: ROWS}, (_, index: number): IRow => ({title: 'row-' + index})),
        });

        test('one edit through a 2000-row computed subscribes a bounded number of times', () => {
            const carburetor = new RowListCarburetor(getRowListData());
            const rows = computed((read) => read(carburetor).items);
            const subscribeSpy = rstest.spyOn(carburetor, 'subscribe');

            let renders = 0;

            class RowsView extends AntiHookComponent {
                render() {
                    renders++;

                    const items = this.useComputed(rows);
                    let text = '';

                    for (let i = 0; i < items.length; i++) {
                        text += items[i].title + '|';
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
});
