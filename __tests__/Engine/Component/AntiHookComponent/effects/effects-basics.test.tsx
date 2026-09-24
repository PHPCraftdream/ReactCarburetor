import * as React from 'react';
import {act} from 'react';
import {fireEvent, render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, ComponentUpdateThrottle} from "@/Carburetor";

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

const useEffectA = (): void => {
    countUseEffectA++;
};

const useEffectB = (): void => {
    countUseEffectB++;
};

describe('<AntiHookComponent />', () => {
    test('re-renders on carburetor update without any hooks', () => {
        const store = new CounterCarburetor(getCounterData());
        const handleClickInc = (): void => store.incValue();

        class Counter extends AntiHookComponent {
            render() {
                const {value} = this.useCarburetor(store);

                return <div>
                    <div className="value">{value}</div>
                    <button className="btn-inc" onClick={handleClickInc}>inc</button>
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
            protected useEffects(): void {
                const {a, b} = this.props;

                this.useEffect(useEffectA, 'useEffectA', [a]);
                this.useEffect(useEffectB, 'useEffectB', [b]);

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
        const closeChannel = (channel: string): void => {
            log.push('close:' + channel);
        };

        class Subscription extends AntiHookComponent<{channel: string}> {
            protected useEffects(): void {
                this.useEffect(
                    () => {
                        const channel = this.props.channel;
                        log.push('open:' + channel);

                        // Cleanup must keep the channel captured when this effect was set up.
                        // carburetor-disable-next-line carburetor/require-method-for-closure
                        return () => closeChannel(channel);
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
        const cleanup = (): void => {
            log.push('cleanup');
        };

        class Watcher extends AntiHookComponent<{channel: string; unrelated: number}> {
            protected useEffects(): void {
                this.useEffect(
                    () => {
                        log.push('run');

                        return cleanup;
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

});
