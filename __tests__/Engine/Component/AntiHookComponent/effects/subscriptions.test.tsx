import {getCounterData, CounterCarburetor, ObservedCarburetor, React, act, render, AntiHookComponent} from '../support';

describe('', () => {
    test('a parent re-render does not cascade into children', () => {
        const store = new CounterCarburetor(getCounterData());
        let parentRenders = 0;
        let childRenders = 0;

        class Child extends AntiHookComponent<{label: string}> {
            render() {
                childRenders++;
                const {value} = this.useCarburetor(store);

                return <span className="child">{this.props.label}{value}</span>;
            }
        }

        class Parent extends AntiHookComponent {
            render() {
                parentRenders++;
                const {other} = this.useCarburetor(store);

                return <div className="parent">{other}<Child label="x"/></div>;
            }
        }

        const {container, unmount} = render(<Parent/>);
        expect(parentRenders).toEqual(1);
        expect(childRenders).toEqual(1);

        // `other` is read by the parent only; the child's props are unchanged.
        act(() => store.incOther());

        expect(parentRenders).toEqual(2);
        expect(childRenders).toEqual(1);

        // The child's own data changed, so it re-renders itself.
        act(() => store.incValue());

        expect(childRenders).toEqual(2);
        expect(container.querySelector('.child')?.textContent).toEqual('x1');

        unmount();
    });

    test('a child re-renders when its own props change', () => {
        const store = new CounterCarburetor(getCounterData());
        let childRenders = 0;

        class Child extends AntiHookComponent<{label: string}> {
            render() {
                childRenders++;

                return <span className="child">{this.props.label}</span>;
            }
        }

        class Parent extends AntiHookComponent<{label: string}> {
            render() {
                this.useCarburetor(store);

                return <div><Child label={this.props.label}/></div>;
            }
        }

        const {container, rerender, unmount} = render(<Parent label="a"/>);
        expect(childRenders).toEqual(1);

        rerender(<Parent label="b"/>);

        expect(childRenders).toEqual(2);
        expect(container.querySelector('.child')?.textContent).toEqual('b');

        unmount();
    });

    test('the gate compares props one level deep, like React.memo', () => {
        let renders = 0;

        class Row extends AntiHookComponent<{data: {id: string}}> {
            render() {
                renders++;

                return <span className="row">{this.props.data.id}</span>;
            }
        }

        const stable = {id: 'a'};
        const {rerender, unmount} = render(<Row data={stable}/>);
        expect(renders).toEqual(1);

        // Same reference: gated out.
        rerender(<Row data={stable}/>);
        expect(renders).toEqual(1);

        // Equal content but a fresh object: treated as changed.
        rerender(<Row data={{id: 'a'}}/>);
        expect(renders).toEqual(2);

        unmount();
    });

    test('runs effects when subclass declares render as a class property', () => {
        let effects = 0;

        class ArrowRender extends AntiHookComponent {
            useEffects = () => {
                effects++;
            };

            // The rule that forbids this is right; the test exists to prove the base class
            // survives it, because this is exactly what used to disable every effect.
            // oxlint-disable-next-line carburetor/no-lifecycle-class-property
            render = () => <div className="arrow">ok</div>;
        }

        const {container, unmount} = render(<ArrowRender />);

        expect(container.querySelector('.arrow')?.textContent).toEqual('ok');
        expect(effects).toEqual(1);

        unmount();
    });

    test('drops subscription to a carburetor no longer read in render', () => {
        const store = new CounterCarburetor(getCounterData());

        interface IUseProps {
            useStore: boolean;
        }

        class Conditional extends AntiHookComponent<IUseProps> {
            render() {
                if (this.props.useStore) {
                    this.useCarburetor(store);
                }

                return <div/>;
            }
        }

        const {rerender, unmount} = render(<Conditional useStore={true} />);
        expect(store.subscriberCount()).toEqual(1);

        rerender(<Conditional useStore={false} />);
        expect(store.subscriberCount()).toEqual(0);

        unmount();
    });

    test('releases carburetor subscription on unmount', () => {
        const store = new CounterCarburetor(getCounterData());

        class Subscriber extends AntiHookComponent {
            render() {
                const {value} = this.useCarburetor(store);

                return <div>{value}</div>;
            }
        }

        const {unmount} = render(<Subscriber />);
        expect(store.subscriberCount()).toEqual(1);

        unmount();

        expect(store.subscriberCount()).toEqual(0);
    });

    test('a re-render with the same read set does not re-subscribe', () => {
        const store = new ObservedCarburetor(getCounterData());

        class Reader extends AntiHookComponent {
            render() {
                const {value} = this.useCarburetor(store);

                return <div className="value">{value}</div>;
            }
        }

        const {container, unmount} = render(<Reader />);

        expect(container.querySelector('.value')?.textContent).toEqual('0');
        expect(store.subscribeReads.length).toEqual(1);
        expect([...store.subscribeReads[0]]).toEqual(['value']);

        // A write to a read path re-renders with identical reads; the commit must skip
        // subscribe() rather than re-register the same paths.
        act(() => store.incValue());
        act(() => store.incOther());

        expect(container.querySelector('.value')?.textContent).toEqual('1');
        expect(store.subscribeReads.length).toEqual(1);
        expect(store.subscriberCount()).toEqual(1);

        unmount();
    });

    test('a changed read set still re-subscribes with the new paths', () => {
        const store = new ObservedCarburetor(getCounterData());

        class Picker extends AntiHookComponent<{wide: boolean}> {
            render() {
                const data = this.useCarburetor(store);

                return <div className="value">{this.props.wide ? data.other : data.value}</div>;
            }
        }

        const {container, rerender, unmount} = render(<Picker wide={false} />);

        expect(store.subscribeReads.length).toEqual(1);
        expect([...store.subscribeReads[0]]).toEqual(['value']);

        // A different key of the same carburetor: the new set must replace the old
        // registration, not stack a second one.
        rerender(<Picker wide={true} />);

        expect(store.subscribeReads.length).toEqual(2);
        expect([...store.subscribeReads[1]]).toEqual(['other']);
        expect(store.subscriberCount()).toEqual(1);

        act(() => store.incOther());

        expect(container.querySelector('.value')?.textContent).toEqual('1');
        expect(store.subscribeReads.length).toEqual(2);

        rerender(<Picker wide={false} />);

        expect(store.subscribeReads.length).toEqual(3);
        expect([...store.subscribeReads[2]]).toEqual(['value']);

        unmount();
    });

    test('a write landing between render and commit still forces the update', () => {
        const store = new ObservedCarburetor(getCounterData());

        // React renders the whole tree before committing any of it, so this sibling writes
        // after the reader's render stamped the version but before its commit — the gap the
        // drift check in commitSubscriptions closes.
        class Early extends AntiHookComponent {
            protected useEffects(): void {
                store.incValue();
            }

            render() {
                return <div/>;
            }
        }

        class Reader extends AntiHookComponent {
            render() {
                const {value} = this.useCarburetor(store);

                return <div className="value">{value}</div>;
            }
        }

        const {container, unmount} = render(<div><Early /><Reader /></div>);

        expect(container.querySelector('.value')?.textContent).toEqual('1');
        expect(store.subscribeReads.length).toEqual(1);

        unmount();
    });

});
