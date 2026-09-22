import * as React from 'react';
import {act} from 'react';
import {fireEvent, render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, ComponentUpdateThrottle, EResourceStatus, computed} from "@/Carburetor";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";
import {TPath, TPathSet} from '@/Carburetor/Models/Paths';
import {TSubscriber} from '@/Carburetor/Models/Base';
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

            void cache.refresh('a');
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
});
