import {getCounterData, CounterCarburetor, ObservedCarburetor, React, act, render, AntiHookComponent} from '../support';

describe('connect', () => {
        test('reads the current value directly, and picks up a later write', () => {
            const store = new CounterCarburetor(getCounterData());

            class Counter extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, unmount} = render(<Counter />);

            expect(container.querySelector('.value')?.textContent).toEqual('0');

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            unmount();
        });

        test('does not subscribe until the component actually commits', () => {
            const store = new CounterCarburetor(getCounterData());

            class Counter extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            // A plain construction, the way React may build an instance it never commits
            // (https://react.dev/reference/react/Component): the field initializer runs, but
            // nothing here should touch the store.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const uncommitted = new Counter({} as never);

            expect(store.subscriberCount()).toEqual(0);

            const {unmount} = render(<Counter />);

            expect(store.subscriberCount()).toEqual(1);

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });

        test('the same view object persists across renders', () => {
            const store = new CounterCarburetor(getCounterData());
            const seen: unknown[] = [];

            class Counter extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    seen.push(this.view);

                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {unmount} = render(<Counter />);

            act(() => store.incValue());
            act(() => store.incValue());

            expect(seen.length).toEqual(3);
            expect(seen[1]).toBe(seen[0]);
            expect(seen[2]).toBe(seen[0]);

            unmount();
        });

        test('re-renders only for a field the render actually read', () => {
            const store = new ObservedCarburetor(getCounterData());

            class Counter extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, unmount} = render(<Counter />);

            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual(['value']);

            act(() => store.incOther());

            expect(container.querySelector('.value')?.textContent).toEqual('0');

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            unmount();
        });

        test('a conditional read narrows and widens the subscription across renders', () => {
            const store = new ObservedCarburetor(getCounterData());

            class Picker extends AntiHookComponent<{wide: boolean}> {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.props.wide ? this.view.other : this.view.value}</div>;
                }
            }

            const {rerender, unmount} = render(<Picker wide={false} />);

            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual(['value']);

            rerender(<Picker wide={true} />);

            expect(store.subscribeReads.length).toEqual(2);
            expect([...store.subscribeReads[1]]).toEqual(['other']);
            expect(store.subscriberCount()).toEqual(1);

            // Re-rendering with the same read set again must not re-register.
            rerender(<Picker wide={true} />);

            expect(store.subscribeReads.length).toEqual(2);

            unmount();
        });

        test('setData keeps the view live on the new data', () => {
            const store = new CounterCarburetor(getCounterData());

            class Counter extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, unmount} = render(<Counter />);

            act(() => {
                store.setData({value: 9, other: 0});
            });

            expect(container.querySelector('.value')?.textContent).toEqual('9');

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('10');

            unmount();
        });

        test('a different carburetor from source() reconnects the subscription', () => {
            const first = new CounterCarburetor(getCounterData());
            const second = new CounterCarburetor({value: 100, other: 0});

            class Counter extends AntiHookComponent<{store: CounterCarburetor}> {
                private readonly view = this.connect(() => this.props.store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, rerender, unmount} = render(<Counter store={first} />);

            expect(container.querySelector('.value')?.textContent).toEqual('0');
            expect(first.subscriberCount()).toEqual(1);

            rerender(<Counter store={second} />);

            expect(container.querySelector('.value')?.textContent).toEqual('100');
            expect(first.subscriberCount()).toEqual(0);
            expect(second.subscriberCount()).toEqual(1);

            act(() => first.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('100');

            act(() => second.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('101');

            unmount();
        });

        test('writing through the view throws and changes nothing', () => {
            const store = new CounterCarburetor(getCounterData());

            class Counter extends AntiHookComponent {
                public readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {unmount} = render(<Counter />);
            const instance = new Counter({} as never);

            expect(() => {
                (instance.view as unknown as {value: number}).value = 5;
            }).toThrow('read-only');

            expect(store.getData().value).toEqual(0);

            unmount();
        });

        test('unsubscribes on unmount', () => {
            const store = new CounterCarburetor(getCounterData());

            class Counter extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {unmount} = render(<Counter />);

            expect(store.subscriberCount()).toEqual(1);

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });

});
