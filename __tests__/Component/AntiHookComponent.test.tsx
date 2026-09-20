import * as React from 'react';
import {act} from 'react';
import {fireEvent, render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, ComponentUpdateThrottle} from "../../lib/src/Carburetor";

interface ICounterData {
    value: number;
    other: number;
}

const getCounterData = (): ICounterData => ({value: 0, other: 0});

class CounterCarburetor extends Carburetor<ICounterData> {
    public subscriberCount = (): number => {
        return Object.keys(this.subscribers).length;
    };

    public incValue = () => {
        this.draft.value++;

        this.emitUpdate();
    };

    public incOther = () => {
        this.draft.other++;

        this.emitUpdate();
    };
}

interface IProps {
    a: number;
    b: number;
}

let countUseEffects: number = 0;
let countUnUseEffects: number = 0;
let countUseEffectA: number = 0;
let countUseEffectB: number = 0;

describe('<AntiHookComponent />', () => {
    test('re-renders on carburetor update without any hooks', () => {
        const store = new CounterCarburetor(getCounterData());

        class Counter extends AntiHookComponent {
            handleClickInc = () => {
                store.incValue();
            };

            render() {
                const {value} = this.useCarburetor(store);

                return <div>
                    <div className="value">{value}</div>
                    <button className="btn-inc" onClick={this.handleClickInc}>inc</button>
                </div>;
            }
        }

        const {container, unmount} = render(<Counter />);
        const value = () => container.querySelector('.value')?.textContent;
        const btn = container.querySelector('.btn-inc') as HTMLButtonElement;

        expect(value()).toEqual('0');

        fireEvent.click(btn);
        expect(value()).toEqual('1');

        fireEvent.click(btn);
        expect(value()).toEqual('2');

        unmount();
    });

    test('does not re-render when an unread path changes', () => {
        const store = new CounterCarburetor(getCounterData());
        let renders = 0;

        class ValueOnly extends AntiHookComponent {
            render() {
                const {value} = this.useCarburetor(store);
                renders++;

                return <div className="value">{value}</div>;
            }
        }

        const {container, unmount} = render(<ValueOnly />);
        expect(renders).toEqual(1);

        act(() => store.incOther());
        expect(renders).toEqual(1);

        act(() => store.incValue());
        expect(renders).toEqual(2);
        expect(container.querySelector('.value')?.textContent).toEqual('1');

        unmount();
    });

    test('throttled carburetor coalesces a burst into a single render', async () => {
        const store = new CounterCarburetor(getCounterData(), new ComponentUpdateThrottle(20));
        let renders = 0;

        class Burst extends AntiHookComponent {
            render() {
                const {value} = this.useCarburetor(store);
                renders++;

                return <div className="value">{value}</div>;
            }
        }

        const {container, unmount} = render(<Burst />);
        expect(renders).toEqual(1);

        store.incValue();
        store.incValue();
        store.incValue();
        expect(renders).toEqual(1);

        await act(() => new Promise(resolve => setTimeout(resolve, 60)));

        expect(renders).toEqual(2);
        expect(container.querySelector('.value')?.textContent).toEqual('3');

        unmount();
    });

    test('mimics effect dependencies through useEffect', () => {
        const store = new CounterCarburetor(getCounterData());

        countUseEffects = 0;
        countUnUseEffects = 0;
        countUseEffectA = 0;
        countUseEffectB = 0;

        class Effects extends AntiHookComponent<IProps> {
            useEffectA = () => {
                countUseEffectA++;
            };

            useEffectB = () => {
                countUseEffectB++;
            };

            protected useEffects(): void {
                const {a, b} = this.props;

                this.useEffect(this.useEffectA, 'useEffectA', [a]);
                this.useEffect(this.useEffectB, 'useEffectB', [b]);

                countUseEffects++;
            }

            protected unUseEffects(): void {
                countUnUseEffects++;
            }

            render() {
                const {value} = this.useCarburetor(store);

                return <div className="value">{value}</div>;
            }
        }

        const {rerender, unmount} = render(<Effects a={0} b={0} />);

        expect(countUseEffects).toEqual(1);
        expect(countUseEffectA).toEqual(1);
        expect(countUseEffectB).toEqual(1);
        expect(countUnUseEffects).toEqual(0);

        // Re-rendering with the same props is gated out entirely: no render, no effects.
        rerender(<Effects a={0} b={0} />);

        expect(countUseEffects).toEqual(1);
        expect(countUnUseEffects).toEqual(0);

        rerender(<Effects a={1} b={0} />);

        expect(countUseEffects).toEqual(2);
        expect(countUseEffectA).toEqual(2);
        expect(countUseEffectB).toEqual(1);
        expect(countUnUseEffects).toEqual(1);

        rerender(<Effects a={1} b={1} />);

        expect(countUseEffects).toEqual(3);
        expect(countUseEffectA).toEqual(2);
        expect(countUseEffectB).toEqual(2);
        expect(countUnUseEffects).toEqual(2);

        // A carburetor-driven update goes through forceUpdate, which bypasses the gate.
        act(() => store.incValue());

        expect(countUseEffects).toEqual(4);
        expect(countUnUseEffects).toEqual(3);

        unmount();

        expect(countUnUseEffects).toEqual(4);
    });

    test('an effect cleanup runs before the effect re-runs and on unmount', () => {
        const log: string[] = [];

        class Subscription extends AntiHookComponent<{channel: string}> {
            protected useEffects(): void {
                this.useEffect(
                    () => {
                        const channel = this.props.channel;
                        log.push('open:' + channel);

                        return () => log.push('close:' + channel);
                    },
                    'channel',
                    [this.props.channel]
                );
            }

            render() {
                return <div/>;
            }
        }

        const {rerender, unmount} = render(<Subscription channel="a"/>);
        expect(log).toEqual(['open:a']);

        rerender(<Subscription channel="b"/>);
        expect(log).toEqual(['open:a', 'close:a', 'open:b']);

        unmount();
        expect(log).toEqual(['open:a', 'close:a', 'open:b', 'close:b']);
    });

    test('an effect with unchanged deps neither re-runs nor cleans up', () => {
        const log: string[] = [];

        class Watcher extends AntiHookComponent<{channel: string; unrelated: number}> {
            protected useEffects(): void {
                this.useEffect(
                    () => {
                        log.push('run');

                        return () => log.push('cleanup');
                    },
                    'channel',
                    [this.props.channel]
                );
            }

            render() {
                return <div/>;
            }
        }

        const {rerender, unmount} = render(<Watcher channel="a" unrelated={1}/>);
        expect(log).toEqual(['run']);

        // The component re-renders because `unrelated` changed, but the effect's own
        // dependency did not, so neither the effect nor its cleanup runs.
        rerender(<Watcher channel="a" unrelated={2}/>);
        expect(log).toEqual(['run']);

        unmount();
        expect(log).toEqual(['run', 'cleanup']);
    });

    test('dependencies are compared element by element', () => {
        let runs = 0;

        class Pair extends AntiHookComponent<{a: number; b: number}> {
            protected useEffects(): void {
                this.useEffect(() => {
                    runs++;
                }, 'pair', [this.props.a, this.props.b]);
            }

            render() {
                return <div/>;
            }
        }

        const {rerender, unmount} = render(<Pair a={1} b={1}/>);
        expect(runs).toEqual(1);

        rerender(<Pair a={1} b={2}/>);
        expect(runs).toEqual(2);

        rerender(<Pair a={2} b={2}/>);
        expect(runs).toEqual(3);

        unmount();
    });

    test('an effect with empty dependencies runs once', () => {
        let runs = 0;

        class Once extends AntiHookComponent<{tick: number}> {
            protected useEffects(): void {
                this.useEffect(() => {
                    runs++;
                }, 'once', []);
            }

            render() {
                return <div>{this.props.tick}</div>;
            }
        }

        const {rerender, unmount} = render(<Once tick={1}/>);
        rerender(<Once tick={2}/>);
        rerender(<Once tick={3}/>);

        expect(runs).toEqual(1);

        unmount();
    });

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
});
