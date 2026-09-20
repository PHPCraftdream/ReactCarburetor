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

                this.useEffect(this.useEffectA, 'useEffectA', a);
                this.useEffect(this.useEffectB, 'useEffectB', b);

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

        rerender(<Effects a={0} b={0} />);

        expect(countUseEffects).toEqual(2);
        expect(countUseEffectA).toEqual(1);
        expect(countUseEffectB).toEqual(1);
        expect(countUnUseEffects).toEqual(1);

        rerender(<Effects a={1} b={0} />);

        expect(countUseEffects).toEqual(3);
        expect(countUseEffectA).toEqual(2);
        expect(countUseEffectB).toEqual(1);
        expect(countUnUseEffects).toEqual(2);

        rerender(<Effects a={1} b={1} />);

        expect(countUseEffects).toEqual(4);
        expect(countUseEffectA).toEqual(2);
        expect(countUseEffectB).toEqual(2);
        expect(countUnUseEffects).toEqual(3);

        act(() => store.incValue());

        expect(countUseEffects).toEqual(5);
        expect(countUnUseEffects).toEqual(4);

        unmount();

        expect(countUnUseEffects).toEqual(5);
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
