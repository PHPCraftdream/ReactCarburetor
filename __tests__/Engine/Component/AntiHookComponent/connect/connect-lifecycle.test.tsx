import {
    ICounterData, getCounterData, ObservedCarburetor, renderArrayItem, React,
    act, render, AntiHookComponent, Carburetor, TReadonly,
} from '../support';

describe('connect', () => {
        test('a child mount callback can write the store without suppressing the parent update', () => {
            const store = new ObservedCarburetor(getCounterData());

            class Child extends AntiHookComponent<{view: TReadonly<ICounterData>}> {
                public componentDidMount(): void {
                    super.componentDidMount();

                    // A write from a child mount callback lands after the parent rendered and
                    // before the parent commits; a commit-time read through the parent's view
                    // must not paper over the version gap the parent's drift check watches.
                    store.incValue();
                    void this.props.view.value;
                }

                render() {
                    // Untracked by design: the child must not widen the parent's subscription
                    // (or any other), so it reads the raw data object directly.
                    // oxlint-disable-next-line carburetor/no-get-data-in-render
                    return <span className="child">{store.getData().value}</span>;
                }
            }

            class Parent extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}<Child view={this.view}/></div>;
                }
            }

            const {container, unmount} = render(<Parent />);

            // The div's whole textContent would read '10': the parent's own text node plus the
            // child's span, which the props gate keeps at its pre-write '0' (its props never
            // changed). The parent's own text node is what carries the regression point.
            expect(container.querySelector('.value')?.firstChild?.textContent).toEqual('1');
            expect(store.subscriberCount()).toEqual(1);

            act(() => store.incValue());

            expect(container.querySelector('.value')?.firstChild?.textContent).toEqual('2');

            unmount();
        });

        test('a source swap between renders validates the new store version too', () => {
            const first = new ObservedCarburetor(getCounterData());
            const second = new ObservedCarburetor({value: 10, other: 0});

            // Writes to whatever store it is handed, during its own commit phase: by the time the
            // reader's commit runs, the version its render captured is already behind.
            class Early extends AntiHookComponent<{store: ObservedCarburetor}> {
                protected useEffects(): void {
                    this.props.store.incValue();
                }

                render() {
                    return <div/>;
                }
            }

            class Swapped extends AntiHookComponent<{store: ObservedCarburetor}> {
                private readonly view = this.connect(() => this.props.store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, rerender, unmount} = render(
                <div><Early store={first}/><Swapped store={first}/></div>
            );

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            rerender(<div><Early store={second}/><Swapped store={second}/></div>);

            expect(first.subscriberCount()).toEqual(0);
            expect(second.subscriberCount()).toEqual(1);
            expect(container.querySelector('.value')?.textContent).toEqual('11');

            unmount();

            expect(second.subscriberCount()).toEqual(0);
        });

        test('unchanged committed dependencies do not rebuild the subscriber index', () => {
            const store = new ObservedCarburetor(getCounterData());

            class Stable extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, unmount} = render(<Stable />);

            expect(store.subscribeReads.length).toEqual(1);

            act(() => store.incValue());
            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('2');
            expect(store.subscribeReads.length).toEqual(1);
            expect(store.subscriberCount()).toEqual(1);

            unmount();
        });

        test('collects reads when render is declared as a class property', () => {
            const store = new ObservedCarburetor(getCounterData());

            class FieldRender extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                // oxlint-disable-next-line carburetor/no-lifecycle-class-property
                render = () => <div className="value">{this.view.value}</div>;
            }

            const {container, unmount} = render(<FieldRender />);

            expect(store.subscriberCount()).toEqual(1);
            expect(container.querySelector('.value')?.textContent).toEqual('0');

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');
            expect(store.subscribeReads.length).toEqual(1);

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });

        test('a replayed mount does not install a subscription for an unused connection', () => {
            const store = new ObservedCarburetor(getCounterData());

            class Maybe extends AntiHookComponent<{show: boolean}> {
                private readonly view = this.connect(() => store);

                render() {
                    return this.props.show ? <div className="value">{this.view.value}</div> : <div/>;
                }
            }

            const {container, rerender, unmount} = render(<React.StrictMode><Maybe show={false} /></React.StrictMode>);

            // Both mount passes must leave an unread connection unsubscribed: no empty
            // registration, and nothing for the replay to mistake for a dependency.
            expect(store.subscriberCount()).toEqual(0);
            expect(store.subscribeReads.length).toEqual(0);

            rerender(<React.StrictMode><Maybe show={true} /></React.StrictMode>);

            expect(store.subscriberCount()).toEqual(1);
            expect(container.querySelector('.value')?.textContent).toEqual('0');

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });

        test('an array-root store reads as an array through the facade', () => {
            const store = new Carburetor<Array<{id: number}>>([{id: 1}, {id: 2}]);

            class List extends AntiHookComponent {
                public readonly view = this.connect(() => store);

                render() {
                    return <ul>{this.view.map(renderArrayItem)}</ul>;
                }
            }

            const instance = new List({} as never);

            expect(Array.isArray(instance.view)).toBe(true);
            expect([...instance.view].length).toEqual(2);
            expect(Object.keys(instance.view)).toEqual(['0', '1']);
            expect(JSON.parse(JSON.stringify(instance.view))).toEqual([{id: 1}, {id: 2}]);

            const {container, unmount} = render(<List />);

            expect(container.querySelectorAll('.item').length).toEqual(2);

            act(() => {
                store.setData([{id: 1}, {id: 2}, {id: 3}]);
            });

            expect(container.querySelectorAll('.item').length).toEqual(3);

            unmount();
        });

        test('a frozen root with primitive fields still reads, enumerates and serializes', () => {
            const store = new Carburetor<{value: number}>(Object.freeze({value: 7}));

            class Frozen extends AntiHookComponent {
                public readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const instance = new Frozen({} as never);

            expect(instance.view.value).toEqual(7);
            expect(Object.keys(instance.view)).toEqual(['value']);
            expect(JSON.parse(JSON.stringify(instance.view))).toEqual({value: 7});
        });

});
