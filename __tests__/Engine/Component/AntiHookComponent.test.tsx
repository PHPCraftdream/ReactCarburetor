import * as React from 'react';
import {act} from 'react';
import {rstest} from '@rstest/core';
import {fireEvent, render} from '@testing-library/react';
import {
    AntiHookComponent,
    Carburetor,
    CarburetorProvider,
    CarburetorScope,
    ComponentUpdateThrottle,
    EResourceStatus,
    IDict,
    ScopedAntiHookComponent,
    carburetorToken,
    computed
} from "@/Carburetor";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";
import {TPath, TPathSet} from '@/Carburetor/Models/Paths';
import {TReadonly, TSubscriber} from '@/Carburetor/Models/Base';
import {ISubscribeOptions} from '@/Carburetor/Models/Store';

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

class ObservedCarburetor extends CounterCarburetor {
    /** One entry per subscribe() that actually ran, holding the read set that call received. */
    public subscribeReads: TPathSet[] = [];

    // The base subscribe is an instance property, so it must be captured before the
    // override below replaces it — this is how the override still reaches the original.
    private readonly baseSubscribe = this.subscribe;

    public subscribe = (callback: TSubscriber, options: ISubscribeOptions = {}): string => {
        this.subscribeReads.push(new Set<TPath>(options.reads ?? []));

        return this.baseSubscribe(callback, options);
    };
}

/**
 * An own enumerable symbol member shared by the selection tests below. A shallow spread copies
 * it, so a snapshot handed out can carry one and the comparison must see it change.
 */
const SYM = Symbol('r2-07');

interface ITodoPayload {
    [key: string]: unknown;
    [SYM]?: number;
}

interface ITodoData {
    payload: ITodoPayload;
}

class TodoCarburetor extends Carburetor<ITodoData> {
    /** Replaces the payload wholesale — the write that wakes a parent reading it. */
    public replacePayload = (payload: ITodoPayload): void => {
        this.update((draft: ITodoData): void => {
            draft.payload = payload;
        });
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

    describe('throwing teardowns (R2-09)', () => {
        test('a throwing effect cleanup still unmounts the rest and releases the subscription', () => {
            const log: string[] = [];
            const store = new CounterCarburetor(getCounterData());

            class TwoCleanups extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(
                        () => {
                            log.push('open:a');

                            return () => {
                                log.push('close:a');

                                throw new Error('cleanup a failed');
                            };
                        },
                        'a',
                        []
                    );

                    this.useEffect(
                        () => {
                            log.push('open:b');

                            return () => log.push('close:b');
                        },
                        'b',
                        []
                    );
                }

                render() {
                    this.useCarburetor(store);

                    return <div/>;
                }
            }

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const {unmount} = render(<TwoCleanups />);

                expect(log).toEqual(['open:a', 'open:b']);
                expect(store.subscriberCount()).toEqual(1);

                // The teardown itself must not throw: the first cleanup's failure costs the
                // component neither the second cleanup nor the subscription it still holds.
                unmount();
            } finally {
                console.error = original;
            }

            expect(log).toEqual(['open:a', 'open:b', 'close:a', 'close:b']);
            expect(store.subscriberCount()).toEqual(0);
            expect(reported.filter((message: string) =>
                message.includes('cleanup a failed') && message.includes('unmount')).length).toEqual(1);
        });

        test('a throwing component-wide unUseEffects still tears down effects and subscriptions', () => {
            const log: string[] = [];
            const store = new CounterCarburetor(getCounterData());

            class BrokenTeardown extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => {
                        log.push('open:a');

                        return () => log.push('close:a');
                    }, 'a', []);
                }

                protected unUseEffects(): void {
                    throw new Error('wide teardown failed');
                }

                render() {
                    this.useCarburetor(store);

                    return <div/>;
                }
            }

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const {unmount} = render(<BrokenTeardown />);

                expect(store.subscriberCount()).toEqual(1);

                unmount();
            } finally {
                console.error = original;
            }

            expect(log).toEqual(['open:a', 'close:a']);
            expect(store.subscriberCount()).toEqual(0);
            expect(reported.filter((message: string) =>
                message.includes('wide teardown failed') && message.includes('unmount')).length).toEqual(1);
        });

        test('replacing an effect whose old cleanup throws still runs the new effect', () => {
            const log: string[] = [];
            const store = new CounterCarburetor(getCounterData());

            class Channel extends AntiHookComponent<{channel: string}> {
                protected useEffects(): void {
                    this.useEffect(
                        () => {
                            const channel = this.props.channel;
                            log.push('open:' + channel);

                            return () => {
                                log.push('close:' + channel);

                                if (channel === 'a') {
                                    throw new Error('cleanup a failed');
                                }
                            };
                        },
                        'channel',
                        [this.props.channel]
                    );
                }

                render() {
                    this.useCarburetor(store);

                    return <div/>;
                }
            }

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const {rerender, unmount} = render(<Channel channel="a"/>);

                expect(log).toEqual(['open:a']);

                // The replaced cleanup throws, but the new effect still has to run: the throw
                // belongs to teardown, not to the effect that replaces it.
                rerender(<Channel channel="b"/>);
                expect(log).toEqual(['open:a', 'close:a', 'open:b']);

                // The new cleanup runs exactly once: no stale reference survives the swap.
                unmount();
                expect(log).toEqual(['open:a', 'close:a', 'open:b', 'close:b']);
                expect(store.subscriberCount()).toEqual(0);
            } finally {
                console.error = original;
            }

            expect(reported.filter((message: string) =>
                message.includes('cleanup a failed') && message.includes('replaced')).length).toEqual(1);
        });

        test('replacing an effect whose new setup throws leaves no stale cleanup behind', () => {
            const log: string[] = [];

            class BrokenSetup extends AntiHookComponent<{fail: boolean}> {
                protected useEffects(): void {
                    this.useEffect(
                        () => {
                            if (this.props.fail) {
                                throw new Error('setup failed');
                            }

                            log.push('open');

                            return () => log.push('cleanup');
                        },
                        'effect',
                        [this.props.fail]
                    );
                }

                render() {
                    return <div/>;
                }
            }

            // React does not re-throw a commit-lifecycle error out of the update that caused
            // it: it reaches the nearest error boundary, which is what makes the failure
            // observable rather than swallowed.
            class Catch extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
                public state = {failed: false};

                public static getDerivedStateFromError(): {failed: boolean} {
                    return {failed: true};
                }

                public render() {
                    return this.state.failed ? <span className="caught">caught</span> : this.props.children;
                }
            }

            // React 19 logs the error this boundary catches; captured so the guard sees
            // only unexpected output.
            const original = console.error;
            const reported: string[] = [];

            console.error = (...args: unknown[]) => reported.push(args.map(String).join(' '));

            try {
                const {container, rerender, unmount} = render(<Catch><BrokenSetup fail={false}/></Catch>);

                expect(log).toEqual(['open']);

                // The setup error still surfaces: a broken setup is as visible as it was before.
                rerender(<Catch><BrokenSetup fail={true}/></Catch>);
                expect(container.querySelector('.caught')?.textContent).toEqual('caught');
                expect(log).toEqual(['open', 'cleanup']);

                // The record moved to the new deps with no cleanup, so the unmount runs nothing again.
                unmount();
                expect(log).toEqual(['open', 'cleanup']);
            } finally {
                console.error = original;
            }

            expect(reported.filter((message: string) =>
                message.includes('The above error occurred in the <BrokenSetup> component')).length).toEqual(1);
        });

        test('a throwing setup still reports the replaced cleanup that threw before it', () => {
            const log: string[] = [];

            class Both extends AntiHookComponent<{fail: boolean}> {
                protected useEffects(): void {
                    this.useEffect(
                        () => {
                            if (this.props.fail) {
                                throw new Error('setup failed');
                            }

                            log.push('open');

                            return () => {
                                log.push('cleanup');

                                throw new Error('cleanup failed');
                            };
                        },
                        'effect',
                        [this.props.fail]
                    );
                }

                render() {
                    return <div/>;
                }
            }

            class Catch extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
                public state = {failed: false};

                public static getDerivedStateFromError(): {failed: boolean} {
                    return {failed: true};
                }

                public render() {
                    return this.state.failed ? <span className="caught">caught</span> : this.props.children;
                }
            }

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const {container, rerender, unmount} = render(<Catch><Both fail={false}/></Catch>);

                expect(log).toEqual(['open']);

                rerender(<Catch><Both fail={true}/></Catch>);
                expect(container.querySelector('.caught')?.textContent).toEqual('caught');
                expect(log).toEqual(['open', 'cleanup']);

                unmount();
                expect(log).toEqual(['open', 'cleanup']);
            } finally {
                console.error = original;
            }

            // The replaced cleanup's complaint is reported even though the setup threw after it.
            expect(reported.filter((message: string) =>
                message.includes('cleanup failed') && message.includes('replaced')).length).toEqual(1);
        });
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

    interface ITodoLike {
        items: {
            [id: string]: {
                title: string;
                done: boolean;
            };
        };
    }

    const getTodoData = (): ITodoLike => ({
        items: {
            a: {title: 'a', done: false},
            b: {title: 'b', done: true},
        },
    });

    class ListCarburetor extends Carburetor<ITodoLike> {
        public setDone = (id: string, done: boolean) => {
            this.draft.items[id].done = done;

            this.emitUpdate();
        };
    }

    const makeLoader = () => {
        const calls: string[] = [];
        const settle: ((value: string) => void)[] = [];

        const load = (id: string): Promise<string> => {
            calls.push(id);

            return new Promise<string>((resolve) => {
                settle.push(resolve);
            });
        };

        return {calls, settle, load};
    };

    const flush = async (): Promise<void> => {
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    };

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

        test('a write to a path of a hidden connection does not trigger renders or loop', () => {
            const store = new ObservedCarburetor(getCounterData());
            let renders = 0;

            class Hidden extends AntiHookComponent<{show: boolean}> {
                private readonly view = this.connect(() => store);

                render() {
                    renders++;

                    // The harness guard keeps a render loop from hanging the suite: this test
                    // asserts a bounded number of renders, so tripping the guard is a failure.
                    if (renders > 40) {
                        throw new Error('bounded render-loop guard tripped');
                    }

                    return this.props.show ? <div className="value">{this.view.value}</div> : <div/>;
                }
            }

            const {rerender, unmount} = render(<Hidden show={true} />);

            expect(store.subscriberCount()).toEqual(1);

            rerender(<Hidden show={false} />);

            // The render that hid the branch must drop the connection's subscription: nothing
            // reads it, so a write to its former dependency may not reach this component again.
            expect(store.subscriberCount()).toEqual(0);

            act(() => store.incValue());

            expect(renders).toEqual(2);
            expect(store.subscriberCount()).toEqual(0);

            unmount();
        });

        test('a handler read does not add paths to the next render subscription', () => {
            const store = new ObservedCarburetor(getCounterData());

            class Reader extends AntiHookComponent<{label: string}> {
                private readonly view = this.connect(() => store);

                handleClick = (): void => {
                    // Reading connected data outside render must stay invisible to tracking:
                    // the next render still subscribes to exactly the paths it reads.
                    void this.view.other;
                };

                render() {
                    return <div>
                        <span className="value">{this.view.value}</span>
                        <span className="label">{this.props.label}</span>
                        <button className="btn" onClick={this.handleClick}>read</button>
                    </div>;
                }
            }

            const {container, rerender, unmount} = render(<Reader label="a" />);

            expect([...store.subscribeReads[0]]).toEqual(['value']);

            fireEvent.click(container.querySelector('.btn') as HTMLButtonElement);

            rerender(<Reader label="b" />);

            // The handler's read is invisible to tracking: the second render commits exactly the
            // read set it made itself, which is unchanged, so the first — and only — registration
            // still names what the render reads.
            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual(['value']);

            unmount();
        });

        test('an effect read does not add paths to a later render', () => {
            const store = new ObservedCarburetor(getCounterData());

            class EffectReader extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                protected useEffects(): void {
                    void this.view.other;
                }

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, unmount} = render(<EffectReader />);

            expect([...store.subscribeReads[0]]).toEqual(['value']);

            act(() => store.incOther());

            expect(container.querySelector('.value')?.textContent).toEqual('0');
            expect(store.subscribeReads.length).toEqual(1);

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');
            // The re-render the write triggered commits the same read set it already has, so
            // nothing re-registers — and the effect's read of 'other' never shows up anywhere.
            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual(['value']);

            unmount();
        });

        test('showing a hidden branch again restores one subscription with current data', () => {
            const store = new ObservedCarburetor(getCounterData());
            let renders = 0;

            class Hidden extends AntiHookComponent<{show: boolean}> {
                private readonly view = this.connect(() => store);

                render() {
                    renders++;

                    return this.props.show ? <div className="value">{this.view.value}</div> : <div/>;
                }
            }

            const {container, rerender, unmount} = render(<Hidden show={true} />);

            expect(store.subscriberCount()).toEqual(1);

            rerender(<Hidden show={false} />);

            expect(store.subscriberCount()).toEqual(0);

            // Data moves while nothing is watching: no render may happen for it.
            act(() => store.incValue());
            act(() => store.incValue());

            expect(renders).toEqual(2);
            expect(store.subscriberCount()).toEqual(0);

            rerender(<Hidden show={true} />);

            expect(container.querySelector('.value')?.textContent).toEqual('2');
            expect(store.subscriberCount()).toEqual(1);
            expect(store.subscribeReads.length).toEqual(2);
            expect([...store.subscribeReads[1]]).toEqual(['value']);

            // The restored subscription keeps working: exactly one registration, still live.
            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('3');
            expect(store.subscribeReads.length).toEqual(2);

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });

        test('a declaration that is never read installs no empty subscription', () => {
            const first = new ObservedCarburetor(getCounterData());
            const second = new ObservedCarburetor(getCounterData());

            class Two extends AntiHookComponent<{useFirst: boolean; tick: number}> {
                private readonly left = this.connect(() => first);
                private readonly right = this.connect(() => second);

                render() {
                    return <div className="value">{this.props.useFirst ? this.left.value : this.right.value}</div>;
                }
            }

            const {container, rerender, unmount} = render(<Two useFirst={true} tick={0} />);

            expect(container.querySelector('.value')?.textContent).toEqual('0');
            expect(first.subscriberCount()).toEqual(1);
            expect(second.subscriberCount()).toEqual(0);

            // Re-commits without reading the second declaration must not install anything for it.
            rerender(<Two useFirst={true} tick={1} />);

            expect(second.subscriberCount()).toEqual(0);

            rerender(<Two useFirst={false} tick={2} />);

            expect(first.subscriberCount()).toEqual(0);
            expect(second.subscriberCount()).toEqual(1);
            expect(container.querySelector('.value')?.textContent).toEqual('0');

            act(() => second.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            unmount();

            expect(second.subscriberCount()).toEqual(0);
        });

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
                    return <ul>{this.view.map(item => <li key={item.id} className="item">{item.id}</li>)}</ul>;
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

        test('a frozen branch is refused with the engine boundary error', () => {
            const store = new Carburetor<{nested: {deep: number}}>(
                Object.freeze({nested: Object.freeze({deep: 1})})
            );

            class FrozenBranch extends AntiHookComponent {
                public readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.nested.deep}</div>;
                }
            }

            const instance = new FrozenBranch({} as never);

            expect(() => instance.view.nested).toThrow('non-configurable');
        });

        test('mutation attempts are rejected and never poison later reads', () => {
            const store = new CounterCarburetor(getCounterData());

            class Counter extends AntiHookComponent {
                public readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, unmount} = render(<Counter />);
            const instance = new Counter({} as never);
            const view = instance.view as unknown as {value: number; other?: number};

            expect(() => {
                view.value = 5;
            }).toThrow('read-only');
            expect(() => {
                delete view.other;
            }).toThrow('read-only');
            expect(() => {
                Object.defineProperty(view, 'value', {value: 9, writable: true, enumerable: true, configurable: true});
            }).toThrow('read-only');
            expect(() => {
                Object.setPrototypeOf(view, {injected: () => 1});
            }).toThrow();
            expect(() => {
                Object.preventExtensions(view);
            }).toThrow();
            expect(Object.isExtensible(view)).toBe(true);
            expect(Object.getPrototypeOf(view)).toBe(Object.prototype);

            expect(store.getData()).toEqual({value: 0, other: 0});

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            unmount();
        });

        test('nested views behind connect() refuse structural mutation (R2-12)', () => {
            class NameCarburetor extends Carburetor<{user: {name: string}}> {
                public rename = (name: string): void => {
                    this.draft.user.name = name;

                    this.emitUpdate();
                };
            }

            const store = new NameCarburetor({user: {name: 'first'}});

            class UserView extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="name">{this.view.user.name}</div>;
                }
            }

            const {container, unmount} = render(<UserView />);

            expect(container.querySelector('.name')?.textContent).toEqual('first');

            const instance = new UserView({} as never);
            const nested = (instance as unknown as {view: {user: {name: string}}}).view.user;
            const rawUser = store.getData().user;

            // The facade's own traps already reject these, but a branch reached through it is
            // an ordinary read proxy from createReadProxy: it must refuse them too, against the
            // raw backing object rather than some copy.
            expect(() => {
                Object.setPrototypeOf(nested, null);
            }).toThrow(/read-only/);
            expect(Object.getPrototypeOf(rawUser)).toBe(Object.prototype);

            expect(() => {
                Object.preventExtensions(nested);
            }).toThrow(/read-only/);
            expect(Object.isExtensible(rawUser)).toBe(true);

            act(() => store.rename('second'));

            // A legitimate draft write still reaches the rendered output.
            expect(container.querySelector('.name')?.textContent).toEqual('second');

            unmount();
        });

        test('restore() keeps the view live on the restored data', () => {
            const store = new CounterCarburetor({value: 5, other: 0});
            const snapshot = store.snapshot();

            class Counter extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, unmount} = render(<Counter />);

            expect(container.querySelector('.value')?.textContent).toEqual('5');

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('6');

            act(() => {
                store.restore(snapshot);
            });

            expect(container.querySelector('.value')?.textContent).toEqual('5');

            unmount();
        });

        test('a scope-backed resolver connects without subscribing during construction', () => {
            const token = carburetorToken<ObservedCarburetor>(
                () => new ObservedCarburetor(getCounterData()),
                'js03/connect/counter'
            );

            class ScopedCounter extends ScopedAntiHookComponent {
                private readonly view = this.connect(() => this.resolve(token));

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const scope = new CarburetorScope();
            const store = scope.get(token);

            // Constructed outside any provider: the resolver cannot resolve yet, the
            // declaration must swallow that quietly, and nothing may subscribe.
            const uncommitted = new ScopedCounter({} as never);

            expect(store.subscriberCount()).toEqual(0);

            const {container, unmount} = render(
                <CarburetorProvider scope={scope}>
                    <ScopedCounter />
                </CarburetorProvider>
            );

            expect(container.querySelector('.value')?.textContent).toEqual('0');

            act(() => {
                store.incValue();
            });

            expect(container.querySelector('.value')?.textContent).toEqual('1');
            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual(['value']);

            unmount();

            expect(store.subscriberCount()).toEqual(0);
            expect(uncommitted).toBeDefined();
        });

        test('an array root behind a scope-backed resolver fails loudly, not with a wrong view', () => {
            const token = carburetorToken<Carburetor<Array<{id: number}>>>(
                () => new Carburetor<Array<{id: number}>>([{id: 1}]),
                'js03/connect/array'
            );

            class ScopedList extends ScopedAntiHookComponent {
                private readonly view = this.connect(() => this.resolve(token));

                render() {
                    return <div className="value">{this.view[0].id}</div>;
                }
            }

            const scope = new CarburetorScope();

            expect(() => {
                render(
                    <CarburetorProvider scope={scope}>
                        <ScopedList />
                    </CarburetorProvider>
                );
            }).toThrow('array');
        });

        test('a source() swap that changes the root kind fails loudly instead of serving a mixed view', () => {
            const arrayStore = new Carburetor<Array<{id: number}>>([{id: 1}]);
            const objectStore = new Carburetor<{value: number}>({value: 0});

            class Swapper extends AntiHookComponent<{useArray: boolean}> {
                private readonly view = this.connect(() => (this.props.useArray ? arrayStore : objectStore));

                render() {
                    const values = this.view as ReadonlyArray<{id: number}>;

                    return <div className="value">{values.length}</div>;
                }
            }

            const {container, rerender, unmount} = render(<Swapper useArray={true} />);

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            expect(() => rerender(<Swapper useArray={false} />)).toThrow('kind');

            unmount();
        });
    });

    describe('child props boundary', () => {
        interface IRow {
            title: string;
            done: boolean;
        }

        interface IRowList {
            items: IDict<IRow>;
        }

        class RowListCarburetor extends Carburetor<IRowList> {
            public subscriberCount = (): number => {
                return Object.keys(this.subscribers).length;
            };

            public rename = (id: string, title: string): void => {
                this.draft.items[id] = {...this.getData().items[id], title};
                this.emitUpdate();
            };

            public renameLeaf = (id: string, title: string): void => {
                this.draft.items[id].title = title;
                this.emitUpdate();
            };
        }

        const getListData = (): IRowList => ({
            items: {
                a: {title: 'Ann', done: false},
                b: {title: 'Bea', done: false},
            },
        });

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

        test('a selection that stops being read is dropped and restored like a connection', () => {
            const store = new RowListCarburetor(getListData());
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent<{show: boolean}> {
                private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

                render() {
                    return this.props.show ? <MemoTitle todo={this.row()} /> : <span className="hidden">off</span>;
                }
            }

            const {container, rerender, unmount} = render(<Parent show />);

            expect(store.subscriberCount()).toEqual(1);

            rerender(<Parent show={false} />);

            expect(store.subscriberCount()).toEqual(0);

            // The write nobody reads must not redraw the hidden child.
            act(() => store.renameLeaf('a', 'Bob'));

            expect(memoRenders).toEqual(1);

            rerender(<Parent show />);

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Bob');
            expect(store.subscriberCount()).toEqual(1);

            unmount();
        });

        test('a selection handing out a live view is reported once in development', () => {
            const store = new RowListCarburetor(getListData());

            class Parent extends AntiHookComponent {
                private readonly row = this.connectSelection(() => store, (data) => ({row: data.items.a}));

                render() {
                    return <span className="live-branch">{this.row().row.title}</span>;
                }
            }

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const view = render(<Parent />);

                view.rerender(<Parent />);
                view.unmount();
            } finally {
                console.error = original;
            }

            // Once per selection, not per render: the mistake is the declaration's.
            expect(reported.filter((message) => message.includes('connectSelection()')).length).toEqual(1);
        });

        // The two tests below pin the documented unsupported escape — see README — for which
        // connectSelection is the supported transfer: a live view handed to a gated child fails
        // silently, and these assert the stale outcome rather than a fix.
        test('unsupported escape: a memo child receiving the live branch keeps stale data after a leaf write', () => {
            const store = new RowListCarburetor(getListData());
            let parentRenders = 0;
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly list = this.connect(() => store);

                render() {
                    parentRenders++;

                    // The parent reads the branch but no leaf, so it subscribes to the branch
                    // marker alone; the child's own reads happen outside the parent's render
                    // attempt and record nothing.
                    return <MemoTitle todo={this.list.items.a} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            act(() => store.renameLeaf('a', 'Bob'));

            expect(parentRenders).toEqual(1);
            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Ann');
            expect(store.getData().items.a.title).toEqual('Bob');

            unmount();
        });

        test('unsupported escape: the props gate bails even when the parent re-renders on the same leaf', () => {
            const store = new RowListCarburetor(getListData());
            let memoRenders = 0;

            const MemoTitle = React.memo(({todo}: {todo: {title: string}}) => {
                memoRenders++;

                return <span className="memo-title">{todo.title}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly list = this.connect(() => store);

                render() {
                    return <div>
                        <span className="heading">{this.list.items.a.title}</span>
                        <MemoTitle todo={this.list.items.a} />
                    </div>;
                }
            }

            const {container, unmount} = render(<Parent />);

            act(() => store.renameLeaf('a', 'Bob'));

            // The parent is live on the leaf and redraws it, but the leaf write did not change
            // the branch object's identity, so the memo child bails and keeps its first render.
            expect(container.querySelector('.heading')?.textContent).toEqual('Bob');
            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-title')?.textContent).toEqual('Ann');

            unmount();
        });

        test('the selection data is deeply read-only and the snapshot type is inferred', () => {
            const store = new RowListCarburetor(getListData());

            class TypedParent extends AntiHookComponent {
                private readonly row = this.connectSelection(
                    () => store,
                    (data) => ({
                        title: data.items.a.title,
                        done: data.items.a.done,
                        upper: data.items.a.title.length > 0
                    })
                );

                // Pins the inferred snapshot type: no casts, no field lists.
                public peek(): {title: string; done: boolean; upper: boolean} {
                    const view = this.row();

                    return {title: view.title, done: view.done, upper: view.upper};
                }

                render() {
                    return <span className="typed">{this.row().title}</span>;
                }
            }

            const {container, unmount} = render(<TypedParent />);

            expect(container.querySelector('.typed')?.textContent).toEqual('Ann');

            // Construction outside React is legal, and the snapshot type still infers.
            const holder = new TypedParent({} as never);

            expect(holder.peek()).toEqual({title: 'Ann', done: false, upper: true});

            unmount();
        });
    });

    describe('under StrictMode', () => {
        test('restores subscriptions when StrictMode replays the mount lifecycles', () => {
            const store = new CounterCarburetor(getCounterData());

            class Counter extends AntiHookComponent {
                render() {
                    const {value} = this.useCarburetor(store);

                    return <div className="value">{value}</div>;
                }
            }

            const {container, unmount} = render(<React.StrictMode><Counter /></React.StrictMode>);

            // The replayed mount lifecycles must restore what the first one subscribed.
            expect(store.subscriberCount()).toEqual(1);

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });

        test('a computed read keeps updating after the replayed mount', () => {
            const carburetor = new ListCarburetor(getTodoData());

            const doneCount = computed<number>((read) => {
                const {items} = read(carburetor);

                return Object.keys(items).filter((id: string) => items[id].done).length;
            });

            class Counter extends AntiHookComponent {
                render() {
                    return <div className="count">{this.useComputed(doneCount)}</div>;
                }
            }

            const {container, unmount} = render(<React.StrictMode><Counter /></React.StrictMode>);

            expect(container.querySelector('.count')?.textContent).toEqual('1');

            act(() => carburetor.setDone('a', true));

            expect(container.querySelector('.count')?.textContent).toEqual('2');

            unmount();
        });

        test('a resource cache read receives its answer after the replayed mount', async () => {
            const loader = makeLoader();
            const cache = new ResourceCache<string, string>(loader.load);

            class Row extends AntiHookComponent<{cache: ResourceCache<string, string>; id: string}> {
                render() {
                    const entry = this.useResource(this.props.cache, this.props.id);

                    return <span className="value">{entry.data || entry.status}</span>;
                }
            }

            const {container, unmount} = render(<React.StrictMode><Row cache={cache} id="a" /></React.StrictMode>);

            expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);

            loader.settle[0]('Ann');
            await flush();

            expect(container.querySelector('.value')?.textContent).toEqual('Ann');
            // The replayed mount must not have queued or started a second request.
            expect(loader.calls).toEqual(['a']);

            unmount();
        });

        test('a cache write still reaches the component after the replayed mount', async () => {
            const loader = makeLoader();
            const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

            // Preloaded, so the mount itself fetches nothing: no write may paper over a
            // subscription the replayed mount lifecycles failed to restore.
            void cache.load('a');
            loader.settle[0]('Ann');
            await flush();

            class Row extends AntiHookComponent<{cache: ResourceCache<string, string>; id: string}> {
                render() {
                    const entry = this.useResource(this.props.cache, this.props.id);

                    return <span className="value">{entry.data || entry.status}</span>;
                }
            }

            const {container, unmount} = render(<React.StrictMode><Row cache={cache} id="a" /></React.StrictMode>);

            expect(container.querySelector('.value')?.textContent).toEqual('Ann');

            // The refresh is an external event like the store writes below: act-wrapped, or
            // React warns about the re-render it triggers.
            act(() => {
                void cache.refresh('a');
            });
            loader.settle[1]('Betty');
            await flush();

            expect(container.querySelector('.value')?.textContent).toEqual('Betty');
            expect(loader.calls).toEqual(['a', 'a']);

            unmount();
        });

        test('a connect() subscription survives the replayed mount lifecycles', () => {
            const store = new CounterCarburetor(getCounterData());

            class Counter extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, unmount} = render(<React.StrictMode><Counter /></React.StrictMode>);

            expect(store.subscriberCount()).toEqual(1);

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });

        test('a render that stops reading a store still drops it after a replayed mount', () => {
            const store = new CounterCarburetor(getCounterData());
            const other = new CounterCarburetor(getCounterData());

            class Conditional extends AntiHookComponent<{useFirst: boolean}> {
                render() {
                    if (this.props.useFirst) {
                        this.useCarburetor(store);
                    } else {
                        this.useCarburetor(other);
                    }

                    return <div/>;
                }
            }

            const {rerender, unmount} = render(<React.StrictMode><Conditional useFirst={true} /></React.StrictMode>);

            expect(store.subscriberCount()).toEqual(1);
            expect(other.subscriberCount()).toEqual(0);

            rerender(<React.StrictMode><Conditional useFirst={false} /></React.StrictMode>);

            expect(store.subscriberCount()).toEqual(0);
            expect(other.subscriberCount()).toEqual(1);

            unmount();
        });
    });

    /**
     * R2-08: a deferred resource load is tentative state of the render attempt that queued it,
     * exactly like the reads are. An abandoned attempt — its render threw an error or a
     * Suspense thenable — must take its queued fetches with it, so a later commit on the same
     * instance drains only the queue of the attempt it consumed.
     */
    describe('deferred resource loads (R2-08)', () => {
        test('a suspended update abandons its queued load, and a later commit fetches only its own key', async () => {
            const loader = makeLoader();
            const cache = new ResourceCache<string, string>(loader.load);
            let resolveGate: (() => void) | undefined;
            let settled = false;
            const gate = new Promise<void>((resolve) => {
                resolveGate = () => {
                    settled = true;
                    resolve();
                };
            });

            class Gate extends AntiHookComponent<{cache: ResourceCache<string, string>; id: string; block: boolean}> {
                render() {
                    const entry = this.useResource(this.props.cache, this.props.id);

                    // Same as the suspense lifecycle tests: React 19 retries a suspended render
                    // immediately, so the gate must keep throwing until it settles, or the retry
                    // commits content and nothing suspends.
                    if (this.props.block && !settled) {
                        throw gate;
                    }

                    return <span className="value">{entry.data || entry.status}</span>;
                }
            }

            const {container, rerender, unmount} = render(
                <React.Suspense fallback={<span className="fallback">wait</span>}>
                    <Gate cache={cache} id="mount" block={false} />
                </React.Suspense>
            );

            expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);

            loader.settle[0]('Mount');
            await flush();

            expect(container.querySelector('.value')?.textContent).toEqual('Mount');

            // Reads 'abandoned' — queuing its deferred load — and then suspends: the attempt is
            // abandoned, and the load it queued must die with it.
            rerender(
                <React.Suspense fallback={<span className="fallback">wait</span>}>
                    <Gate cache={cache} id="abandoned" block={true} />
                </React.Suspense>
            );

            expect(container.querySelector('.fallback')?.textContent).toEqual('wait');

            // A later update on the SAME instance, still while the gate is pending: it commits,
            // and the commit must drain only its own attempt's queue.
            rerender(
                <React.Suspense fallback={<span className="fallback">wait</span>}>
                    <Gate cache={cache} id="committed" block={false} />
                </React.Suspense>
            );

            expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);
            // The abandoned key is never fetched: its load was never promoted to a real request.
            expect(loader.calls).toEqual(['mount', 'committed']);

            // The retry React owes the abandoned update runs with the CURRENT props: the
            // committed entry is already in flight, so nothing queues and nothing loads.
            await act(async () => {
                resolveGate?.();
                await gate;
            });

            expect(loader.calls).toEqual(['mount', 'committed']);

            loader.settle[1]('Committed');
            await flush();

            expect(container.querySelector('.value')?.textContent).toEqual('Committed');
            expect(loader.calls).toEqual(['mount', 'committed']);

            unmount();
        });

        test('repeated suspended attempts abandon their queue, and the retried render loads once', async () => {
            const loader = makeLoader();
            const cache = new ResourceCache<string, string>(loader.load);
            let resolveGate: (() => void) | undefined;
            let settled = false;
            const gate = new Promise<void>((resolve) => {
                resolveGate = () => {
                    settled = true;
                    resolve();
                };
            });

            class Gate extends AntiHookComponent<{cache: ResourceCache<string, string>; id: string; block: boolean}> {
                render() {
                    const entry = this.useResource(this.props.cache, this.props.id);

                    // Same as the suspense lifecycle tests: React 19 retries a suspended render
                    // immediately, so the gate must keep throwing until it settles.
                    if (this.props.block && !settled) {
                        throw gate;
                    }

                    return <span className="value">{entry.data || entry.status}</span>;
                }
            }

            const {container, rerender, unmount} = render(
                <React.Suspense fallback={<span className="fallback">wait</span>}>
                    <Gate cache={cache} id="mount" block={false} />
                </React.Suspense>
            );

            loader.settle[0]('Mount');
            await flush();

            expect(container.querySelector('.value')?.textContent).toEqual('Mount');

            // Two updates in a row read 'repeat' and suspend: each abandons an attempt that
            // queued the same deferred load, and neither attempt is consumed by a commit.
            rerender(
                <React.Suspense fallback={<span className="fallback">wait</span>}>
                    <Gate cache={cache} id="repeat" block={true} />
                </React.Suspense>
            );

            expect(container.querySelector('.fallback')?.textContent).toEqual('wait');

            rerender(
                <React.Suspense fallback={<span className="fallback">wait</span>}>
                    <Gate cache={cache} id="repeat" block={true} />
                </React.Suspense>
            );

            expect(container.querySelector('.fallback')?.textContent).toEqual('wait');
            expect(loader.calls).toEqual(['mount']);

            // The retried render commits reading 'repeat': one attempt survives, so one load.
            // Even if the abandoned queues had survived, ResourceCache.fetch dedups concurrent
            // same-key requests — only the surviving attempt's queue is drained either way.
            await act(async () => {
                resolveGate?.();
                await gate;
            });

            expect(loader.calls).toEqual(['mount', 'repeat']);
            expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);

            unmount();
        });

        test('a thrown-error attempt takes its queued load with it, and recovery loads its own key', async () => {
            const loader = makeLoader();
            const cache = new ResourceCache<string, string>(loader.load);

            class Flaky extends AntiHookComponent<{cache: ResourceCache<string, string>; id: string; fail: boolean}> {
                render() {
                    const entry = this.useResource(this.props.cache, this.props.id);

                    if (this.props.fail) {
                        throw new Error('flaky');
                    }

                    return <span className="value">{entry.data || entry.status}</span>;
                }
            }

            class Catch extends React.Component<{children: React.ReactNode}, {failed: boolean; seen: React.ReactNode}> {
                public state = {failed: false, seen: this.props.children};

                public static getDerivedStateFromError(): {failed: boolean} {
                    return {failed: true};
                }

                // A new subtree earns a fresh attempt: the boundary recovers instead of staying
                // latched, which is what remounts a fresh instance for the recovery update.
                public static getDerivedStateFromProps(
                    props: Readonly<{children: React.ReactNode}>,
                    state: {failed: boolean; seen: React.ReactNode}
                ): {failed: boolean; seen: React.ReactNode} | null {
                    return props.children === state.seen ? null : {failed: false, seen: props.children};
                }

                public render() {
                    return this.state.failed ? <span className="caught">caught</span> : this.props.children;
                }
            }

            // React 19 logs the error this boundary catches; captured so the guard sees
            // only unexpected output.
            const original = console.error;
            const reported: string[] = [];

            console.error = (...args: unknown[]) => reported.push(args.map(String).join(' '));

            try {
                const {container, rerender, unmount} = render(
                    <Catch><Flaky cache={cache} id="seed" fail={false} /></Catch>
                );

                loader.settle[0]('Seed');
                await flush();

                expect(container.querySelector('.value')?.textContent).toEqual('Seed');
                expect(loader.calls).toEqual(['seed']);

                // Reads 'abandoned' — queuing its load — and then throws: the boundary replaces the
                // subtree, and the queue must not outlive the attempt anywhere shared.
                rerender(<Catch><Flaky cache={cache} id="abandoned" fail={true} /></Catch>);

                expect(container.querySelector('.caught')?.textContent).toEqual('caught');
                expect(loader.calls).toEqual(['seed']);

                // The boundary remounts a fresh instance for the recovery: it loads only its own key.
                rerender(<Catch><Flaky cache={cache} id="recovery" fail={false} /></Catch>);

                expect(loader.calls).toEqual(['seed', 'recovery']);

                loader.settle[1]('Recovery');
                await flush();

                expect(container.querySelector('.value')?.textContent).toEqual('Recovery');
                expect(loader.calls).toEqual(['seed', 'recovery']);

                unmount();
            } finally {
                console.error = original;
            }

            expect(reported.filter((message: string) =>
                message.includes('The above error occurred in the <Flaky> component')).length).toEqual(1);
        });

        test('changing arguments keeps one load per committed read', async () => {
            const loader = makeLoader();
            const cache = new ResourceCache<string, string>(loader.load);

            class Row extends AntiHookComponent<{cache: ResourceCache<string, string>; id: string}> {
                render() {
                    const entry = this.useResource(this.props.cache, this.props.id);

                    return <span className="value">{entry.data || entry.status}</span>;
                }
            }

            const {container, rerender, unmount} = render(<Row cache={cache} id="a" />);

            expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);

            loader.settle[0]('Ann');
            await flush();

            expect(container.querySelector('.value')?.textContent).toEqual('Ann');

            rerender(<Row cache={cache} id="b" />);

            // One load per committed key: 'b' is fetched, 'a' is not fetched a second time.
            expect(loader.calls).toEqual(['a', 'b']);
            expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);

            unmount();
        });

        test('a useResource call outside a render attempt reports in development and queues nothing', () => {
            const loader = makeLoader();
            const cache = new ResourceCache<string, string>(loader.load);

            class Outside extends AntiHookComponent<{cache: ResourceCache<string, string>}> {
                // The handler-shaped read: there is no render attempt open, so there is no
                // attempt to attribute a deferred load to.
                public readOutside = (): unknown => this.useResource(this.props.cache, 'outside');

                render() {
                    return <span className="value">{EResourceStatus.Idle}</span>;
                }
            }

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const holder = new Outside({cache});

                holder.readOutside();
                holder.readOutside();
            } finally {
                console.error = original;
            }

            // Once per call, naming the load that was skipped and where the API belongs.
            const complaints = reported.filter((message: string) => message.includes('useResource()'));

            expect(complaints.length).toEqual(2);
            expect(complaints[0].includes('outside')).toEqual(true);
            // Nothing was queued, so nothing can be fetched: no load ran outside render either.
            expect(loader.calls).toEqual([]);
        });
    });

    describe('render attempt lifecycle', () => {
        test('a failed mount render installs nothing', () => {
            const store = new ObservedCarburetor(getCounterData());
            let renders = 0;

            class Boom extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    renders++;

                    const value = this.view.value;

                    throw new Error('boom after reading ' + value);
                }
            }

            expect(() => render(<Boom />)).toThrow('boom');

            // The attempt that threw is abandoned: what it collected is never published and no
            // subscription is installed for a component that never committed.
            expect(store.subscriberCount()).toEqual(0);
            expect(store.subscribeReads.length).toEqual(0);
            // React 19 retries an errored render once before propagating it: both attempts run
            // here, and both are abandoned by the boundary.
            expect(renders).toEqual(2);
        });

        test('a failed update render publishes nothing new and leaves no leak', () => {
            const store = new ObservedCarburetor(getCounterData());

            class Flaky extends AntiHookComponent<{fail: boolean}> {
                private readonly view = this.connect(() => store);

                render() {
                    if (this.props.fail) {
                        throw new Error('flaky');
                    }

                    return <div className="value">{this.view.value}</div>;
                }
            }

            class Catch extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
                public state = {failed: false};

                public static getDerivedStateFromError(): {failed: boolean} {
                    return {failed: true};
                }

                public render() {
                    return this.state.failed ? <span className="caught">caught</span> : this.props.children;
                }
            }

            // React 19 logs the error this boundary catches; captured so the guard sees
            // only unexpected output.
            const original = console.error;
            const reported: string[] = [];

            console.error = (...args: unknown[]) => reported.push(args.map(String).join(' '));

            try {
                const {container, rerender, unmount} = render(<Catch><Flaky fail={false} /></Catch>);

                expect(container.querySelector('.value')?.textContent).toEqual('0');
                expect(store.subscriberCount()).toEqual(1);
                expect(store.subscribeReads.length).toEqual(1);

                rerender(<Catch><Flaky fail={true} /></Catch>);

                expect(container.querySelector('.caught')?.textContent).toEqual('caught');
                // The abandoned attempt published nothing; the boundary replacing the subtree
                // released what the last good commit held.
                expect(store.subscribeReads.length).toEqual(1);
                expect(store.subscriberCount()).toEqual(0);

                unmount();
            } finally {
                console.error = original;
            }

            expect(reported.filter((message: string) =>
                message.includes('The above error occurred in the <Flaky> component')).length).toEqual(1);
        });

        test('a suspended mount leaves no subscription and recovers with fresh data', async () => {
            const store = new ObservedCarburetor(getCounterData());
            let resolveGate: (() => void) | undefined;
            let settled = false;
            const gate = new Promise<void>((resolve) => {
                resolveGate = () => {
                    settled = true;
                    resolve();
                };
            });

            class Later extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    const value = this.view.value;

                    // React 19 retries a suspended render synchronously: the render must keep
                    // throwing while the gate is pending, or the retry commits content and
                    // nothing suspends.
                    if (!settled) {
                        throw gate;
                    }

                    return <div className="value">{value}</div>;
                }
            }

            const {container, unmount} = render(
                <React.Suspense fallback={<span className="fallback">wait</span>}><Later /></React.Suspense>
            );

            expect(container.querySelector('.fallback')?.textContent).toEqual('wait');
            expect(store.subscriberCount()).toEqual(0);
            expect(store.subscribeReads.length).toEqual(0);

            act(() => store.incValue());

            await act(async () => {
                resolveGate?.();
                await gate;
            });

            expect(container.querySelector('.value')?.textContent).toEqual('1');
            expect(store.subscriberCount()).toEqual(1);

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('2');

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });

        test('suspense hide and reveal preserve the committed subscription without leaks', async () => {
            const store = new ObservedCarburetor(getCounterData());
            let resolveGate: (() => void) | undefined;
            let settled = false;
            const gate = new Promise<void>((resolve) => {
                resolveGate = () => {
                    settled = true;
                    resolve();
                };
            });

            class Gate extends AntiHookComponent<{block: boolean}> {
                private readonly view = this.connect(() => store);

                render() {
                    const value = this.view.value;

                    // Same as the mount case: React 19 retries a suspended render immediately,
                    // so the gate must keep throwing until it settles, or no suspension happens.
                    if (this.props.block && !settled) {
                        throw gate;
                    }

                    return <div className="value">{value}</div>;
                }
            }

            const {container, rerender, unmount} = render(
                <React.Suspense fallback={<span className="fallback">wait</span>}>
                    <Gate block={false} />
                </React.Suspense>
            );

            expect(container.querySelector('.value')?.textContent).toEqual('0');
            expect(store.subscriberCount()).toEqual(1);

            rerender(
                <React.Suspense fallback={<span className="fallback">wait</span>}>
                    <Gate block={true} />
                </React.Suspense>
            );

            // The suspended update hides the tree; whatever React did with the hidden
            // instance, no render may run for writes nobody can see.
            act(() => store.incValue());

            expect(container.querySelector('.fallback')?.textContent).toEqual('wait');

            await act(async () => {
                resolveGate?.();
                await gate;
            });

            expect(container.querySelector('.value')?.textContent).toEqual('1');
            expect(store.subscriberCount()).toEqual(1);

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('2');
            expect(store.subscriberCount()).toEqual(1);

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });
    });

    describe('connected read work', () => {
        test('one render reading several fields resolves the source once and captures the baseline once', () => {
            const store = new ObservedCarburetor(getCounterData());
            const versionSpy = rstest.spyOn(store, 'getVersion');
            let resolutions = 0;

            class Wide extends AntiHookComponent<{tick: number}> {
                private readonly view = this.connect(() => {
                    resolutions++;

                    return store;
                });

                render() {
                    const {value, other} = this.view;

                    return <div className="value">{value}-{other}</div>;
                }
            }

            const {rerender, unmount} = render(<Wide tick={0} />);

            // The declaration's shape probe and the mount attempt did their work; only the next
            // attempt is being measured.
            const mountResolutions = resolutions;
            const mountVersions = versionSpy.mock.calls.length;

            rerender(<Wide tick={1} />);

            // One attempt, two fields read through the facade: the source is resolved once for
            // the whole attempt — not once per field, and not again by the recorder's baseline
            // capture — and the baseline version is captured once. The second getVersion call is
            // the commit-time drift check, which runs once per commit, not per read.
            expect(resolutions - mountResolutions).toEqual(1);
            expect(versionSpy.mock.calls.length - mountVersions).toEqual(2);

            unmount();
        });

        test('a multi-field useCarburetor read keeps resolving once per attempt', () => {
            const store = new ObservedCarburetor(getCounterData());
            const uidSpy = rstest.spyOn(store, 'getUID');
            const versionSpy = rstest.spyOn(store, 'getVersion');

            class Hooked extends AntiHookComponent<{tick: number}> {
                render() {
                    const {value, other} = this.useCarburetor(store);

                    return <div className="value">{value}-{other}</div>;
                }
            }

            const {rerender, unmount} = render(<Hooked tick={0} />);

            const mountUids = uidSpy.mock.calls.length;
            const mountVersions = versionSpy.mock.calls.length;

            rerender(<Hooked tick={1} />);

            // One attempt: one identity lookup for the tracked record, one baseline capture,
            // plus the commit's drift check — reading a second field adds none of that again.
            expect(uidSpy.mock.calls.length - mountUids).toEqual(1);
            expect(versionSpy.mock.calls.length - mountVersions).toEqual(2);

            unmount();
        });

        test('a source swap resolves the new store in its own attempt, once', () => {
            const first = new ObservedCarburetor(getCounterData());
            const second = new ObservedCarburetor({value: 100, other: 0});
            let resolutions = 0;

            class Swapped extends AntiHookComponent<{store: ObservedCarburetor; tick: number}> {
                private readonly view = this.connect(() => {
                    resolutions++;

                    return this.props.store;
                });

                render() {
                    const {value, other} = this.view;

                    return <div className="value">{value}-{other}</div>;
                }
            }

            const {container, rerender, unmount} = render(<Swapped store={first} tick={0} />);

            expect(container.querySelector('.value')?.textContent).toEqual('0-0');
            // One declaration-time shape probe, one resolution for the mount attempt.
            expect(resolutions).toEqual(2);

            rerender(<Swapped store={second} tick={1} />);

            expect(container.querySelector('.value')?.textContent).toEqual('100-0');
            expect(first.subscriberCount()).toEqual(0);
            expect(second.subscriberCount()).toEqual(1);
            // A new attempt resolved the source exactly once more: nothing was carried across
            // renders, and the swap was noticed.
            expect(resolutions).toEqual(3);

            act(() => second.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('101-0');

            unmount();
        });

        test('a root replacement between attempts is fully visible to a multi-field read', () => {
            const store = new ObservedCarburetor(getCounterData());

            class Counter extends AntiHookComponent<{tick: number}> {
                private readonly view = this.connect(() => store);

                render() {
                    const {value, other} = this.view;

                    return <div className="value">{value}-{other}</div>;
                }
            }

            const {container, rerender, unmount} = render(<Counter tick={0} />);

            expect(container.querySelector('.value')?.textContent).toEqual('0-0');

            act(() => {
                store.setData({value: 9, other: 8});
            });

            rerender(<Counter tick={1} />);

            // Both fields of the new read come from the new root — no per-attempt sharing may
            // reuse the replaced object.
            expect(container.querySelector('.value')?.textContent).toEqual('9-8');

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('10-8');

            unmount();
        });

        test('an event read gets current data after a root swap and records nothing', () => {
            const store = new ObservedCarburetor(getCounterData());
            let handlerSaw = '';

            class Reader extends AntiHookComponent<{tick: number}> {
                private readonly view = this.connect(() => store);

                handleCheck = (): void => {
                    const {value, other} = this.view;

                    handlerSaw = value + '-' + other;
                };

                render() {
                    return <div>
                        <span className="value">{this.view.value}</span>
                        <button className="btn" onClick={this.handleCheck}>check</button>
                    </div>;
                }
            }

            const {container, rerender, unmount} = render(<Reader tick={0} />);

            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual(['value']);

            act(() => {
                store.setData({value: 5, other: 6});
            });

            fireEvent.click(container.querySelector('.btn') as HTMLButtonElement);

            // The handler read the replaced root's current data through the persistent view...
            expect(handlerSaw).toEqual('5-6');
            // ...and recorded nothing: the subscription still names exactly what the render read.
            expect(store.subscribeReads.length).toEqual(1);

            rerender(<Reader tick={1} />);

            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual(['value']);

            unmount();
        });

        test('connectSelection shares the source resolution across the fields its selector reads', () => {
            const store = new ListCarburetor(getTodoData());
            let resolutions = 0;

            class Row extends AntiHookComponent<{tick: number}> {
                private readonly row = this.connectSelection(() => {
                    resolutions++;

                    return store;
                }, (data) => ({title: data.items.a.title, done: data.items.a.done}));

                render() {
                    const {title, done} = this.row();

                    return <div className="value">{title}-{String(done)}</div>;
                }
            }

            const {container, rerender, unmount} = render(<Row tick={0} />);

            expect(container.querySelector('.value')?.textContent).toEqual('a-false');

            const mountResolutions = resolutions;

            rerender(<Row tick={1} />);

            // The selector reads through the facade once and through two branch fields: one
            // attempt, one resolution — not one per selected field.
            expect(resolutions - mountResolutions).toEqual(1);

            act(() => store.setDone('a', true));

            expect(container.querySelector('.value')?.textContent).toEqual('a-true');

            unmount();
        });
    });

    describe('render definition and modern lifecycle APIs (R2-04)', () => {
        type TModernLifecycle = 'none' | 'derived' | 'snapshot';

        // One fresh class per call, written the way a user writes it: the combination of
        // render definition style and modern lifecycle API is the defect surface of R2-04 —
        // React skips mount lifecycle hooks for components that define
        // getDerivedStateFromProps or getSnapshotBeforeUpdate, so a boundary installed by a
        // mount hook silently never runs for those.
        const buildComponent = (
            store: ObservedCarburetor,
            fieldRender: boolean,
            modern: TModernLifecycle,
            countRender: () => void
        ): typeof AntiHookComponent => {
            if (!fieldRender) {
                if (modern === 'none') {
                    class MethodPlain extends AntiHookComponent {
                        private readonly view = this.connect(() => store);

                        public render(): React.ReactNode {
                            countRender();

                            return <div className="value">{this.view.value}</div>;
                        }
                    }

                    return MethodPlain;
                }

                if (modern === 'derived') {
                    class MethodDerived extends AntiHookComponent {
                        // An object, not null: React warns about getDerivedStateFromProps with
                        // a null initial state.
                        public state = {};

                        private readonly view = this.connect(() => store);

                        public static getDerivedStateFromProps(): null {
                            return null;
                        }

                        public render(): React.ReactNode {
                            countRender();

                            return <div className="value">{this.view.value}</div>;
                        }
                    }

                    return MethodDerived;
                }

                class MethodSnapshot extends AntiHookComponent {
                    private readonly view = this.connect(() => store);

                    public getSnapshotBeforeUpdate(): null {
                        return null;
                    }

                    public componentDidUpdate(previousProps: Readonly<Record<string, never>>): void {
                        super.componentDidUpdate(previousProps);
                    }

                    public render(): React.ReactNode {
                        countRender();

                        return <div className="value">{this.view.value}</div>;
                    }
                }

                return MethodSnapshot;
            }

            if (modern === 'none') {
                class FieldPlain extends AntiHookComponent {
                    private readonly view = this.connect(() => store);

                    // oxlint-disable-next-line carburetor/no-lifecycle-class-property
                    render = (): React.ReactNode => {
                        countRender();

                        return <div className="value">{this.view.value}</div>;
                    };
                }

                return FieldPlain;
            }

            if (modern === 'derived') {
                class FieldDerived extends AntiHookComponent {
                    public state = {};

                    private readonly view = this.connect(() => store);

                    public static getDerivedStateFromProps(): null {
                        return null;
                    }

                    // oxlint-disable-next-line carburetor/no-lifecycle-class-property
                    render = (): React.ReactNode => {
                        countRender();

                        return <div className="value">{this.view.value}</div>;
                    };
                }

                return FieldDerived;
            }

            class FieldSnapshot extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                public getSnapshotBeforeUpdate(): null {
                    return null;
                }

                public componentDidUpdate(previousProps: Readonly<Record<string, never>>): void {
                    super.componentDidUpdate(previousProps);
                }

                // oxlint-disable-next-line carburetor/no-lifecycle-class-property
                render = (): React.ReactNode => {
                    countRender();

                    return <div className="value">{this.view.value}</div>;
                };
            }

            return FieldSnapshot;
        };

        for (const fieldRender of [false, true]) {
            for (const modern of ['none', 'derived', 'snapshot'] as const) {
                const shape = fieldRender ? 'class-field' : 'prototype-method';
                const label = modern === 'none' ? 'no modern lifecycle API' : modern;

                test(`a ${shape} render with ${label} is tracked from the first mount`, () => {
                    const store = new ObservedCarburetor(getCounterData());
                    let renders = 0;
                    const Component = buildComponent(store, fieldRender, modern, () => {
                        renders++;
                    });
                    const {container, unmount} = render(<Component />);

                    expect(store.subscriberCount()).toEqual(1);
                    expect(container.querySelector('.value')?.textContent).toEqual('0');
                    // The boundary was already in place for the first render: tracking never
                    // needed a second render to catch up.
                    expect(renders).toEqual(1);

                    act(() => store.incValue());

                    expect(container.querySelector('.value')?.textContent).toEqual('1');

                    unmount();

                    expect(store.subscriberCount()).toEqual(0);
                });

                test(`a ${shape} render with ${label} is tracked under StrictMode`, () => {
                    const store = new ObservedCarburetor(getCounterData());
                    const Component = buildComponent(store, fieldRender, modern, () => undefined);
                    const {container, unmount} = render(<React.StrictMode><Component /></React.StrictMode>);

                    expect(store.subscriberCount()).toEqual(1);

                    act(() => store.incValue());

                    expect(container.querySelector('.value')?.textContent).toEqual('1');

                    unmount();

                    expect(store.subscriberCount()).toEqual(0);
                });
            }
        }

        test('a render assigned in the constructor body is wrapped at assignment time', () => {
            const store = new ObservedCarburetor(getCounterData());
            let renders = 0;

            class Assigned extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                public constructor(props: Readonly<object>) {
                    super(props);

                    this.render = (): React.ReactNode => {
                        renders++;

                        return <div className="value">{this.view.value}</div>;
                    };
                }
            }

            const {container, unmount} = render(<Assigned />);

            expect(store.subscriberCount()).toEqual(1);
            expect(container.querySelector('.value')?.textContent).toEqual('0');
            expect(renders).toEqual(1);

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });
    });
});
