import {
    getCounterData, CounterCarburetor, getTodoData, ListCarburetor, makeLoader, flush,
    React, act, render, AntiHookComponent, EResourceStatus, computed, ResourceCache,
} from '../support';

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
