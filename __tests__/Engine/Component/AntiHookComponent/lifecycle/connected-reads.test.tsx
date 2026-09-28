import {
    getCounterData, ObservedCarburetor, getTodoData, ListCarburetor,
    act, rstest, fireEvent, render, AntiHookComponent, Carburetor,
    TPath, TPathSet, TSubscriber, ISubscribeOptions,
} from '../support';
import {WILDCARD_PATH} from '@/Carburetor/Store/Paths/WildcardPath';

/** A non-trackable root: read() marks the wildcard and hands back raw data, no proxy involved. */
class ObservedMapCarburetor extends Carburetor<Map<string, number>> {
    public subscribeReads: TPathSet[] = [];

    private readonly baseSubscribe = this.subscribe;

    public subscribe = (callback: TSubscriber, options: ISubscribeOptions = {}): string => {
        this.subscribeReads.push(new Set<TPath>(options.reads ?? []));
        return this.baseSubscribe(callback, options);
    };

    public setKey = (key: string, value: number): void => {
        this.update((draft: Map<string, number>) => {
            // oxlint-disable-next-line carburetor/no-untrackable-draft-mutation
            draft.set(key, value);
        });
    };
}

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

        test('useCarburetor returns the same root view across renders while the data object is unchanged', () => {
            const store = new ObservedCarburetor(getCounterData());
            const seen: unknown[] = [];

            class Stable extends AntiHookComponent<{tick: number}> {
                render() {
                    const view = this.useCarburetor(store);

                    seen.push(view);

                    return <div className="value">{view.value}</div>;
                }
            }

            const {rerender, unmount} = render(<Stable tick={0} />);

            rerender(<Stable tick={1} />);
            rerender(<Stable tick={2} />);

            expect(seen.length).toEqual(3);
            expect(seen[0]).toBe(seen[1]);
            expect(seen[1]).toBe(seen[2]);

            unmount();
        });

        test('useCarburetor rebuilds its root view once setData replaces the data object', () => {
            const store = new ObservedCarburetor(getCounterData());
            const seen: unknown[] = [];

            class Rebuild extends AntiHookComponent {
                render() {
                    const view = this.useCarburetor(store);

                    seen.push(view);

                    return <div className="value">{view.value}</div>;
                }
            }

            const {container, unmount} = render(<Rebuild />);

            expect(seen.length).toEqual(1);

            act(() => {
                store.setData({value: 9, other: 8});
            });

            expect(container.querySelector('.value')?.textContent).toEqual('9');
            expect(seen.length).toEqual(2);
            expect(seen[0]).not.toBe(seen[1]);

            unmount();
        });

        test('a useCarburetor view read from a handler after commit gets current data and records nothing', () => {
            const store = new ObservedCarburetor(getCounterData());
            let handlerSaw = '';

            class Reader extends AntiHookComponent {
                private captured: {value: number; other: number} | undefined;

                handleCheck = (): void => {
                    const view = this.captured as {value: number; other: number};

                    handlerSaw = view.value + '-' + view.other;
                };

                render() {
                    this.captured = this.useCarburetor(store);

                    return <div>
                        <span className="value">{this.captured.value}</span>
                        <button className="btn" onClick={this.handleCheck}>check</button>
                    </div>;
                }
            }

            const {container, unmount} = render(<Reader />);

            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual(['value']);

            // A write to a field this render never read: no re-render, so the handler's later
            // read is the first thing to see it.
            act(() => store.incOther());

            fireEvent.click(container.querySelector('.btn') as HTMLButtonElement);

            // The handler read the persistent view outside render and saw current data...
            expect(handlerSaw).toEqual('0-1');
            // ...but recorded nothing: no new subscription was installed for it.
            expect(store.subscribeReads.length).toEqual(1);

            unmount();
        });

        test('a stale view read before the next render recalls useCarburetor adds nothing to it', () => {
            const store = new ObservedCarburetor(getCounterData());
            let staleView: {value: number; other: number} | undefined;

            class Peek extends AntiHookComponent<{tick: number}> {
                render() {
                    // A stale read through last render's captured view, before this render's own
                    // useCarburetor call refreshes which attempt the view's recorder reports to.
                    if (staleView) {
                        void staleView.other;
                    }

                    const view = this.useCarburetor(store);

                    staleView = view;

                    return <div className="value">{view.value}</div>;
                }
            }

            const {rerender, unmount} = render(<Peek tick={0} />);

            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual(['value']);

            rerender(<Peek tick={1} />);

            // Had the stale pre-call read of `.other` counted toward this attempt, the read set
            // would widen to ['value', 'other'] and force a fresh subscription; an unchanged
            // read set instead skips re-registering entirely, so the count stays exactly as before.
            expect(store.subscribeReads.length).toEqual(1);

            unmount();
        });

        test('useCarburetor on a non-trackable root marks the wildcard on every render, not just the first', () => {
            const store = new ObservedMapCarburetor(new Map<string, number>([['a', 1]]));

            class Reader extends AntiHookComponent<{tick: number}> {
                render() {
                    const data = this.useCarburetor(store);

                    return <div className="value">{data.get('a')}-{data.get('b') ?? 'none'}</div>;
                }
            }

            const {container, rerender, unmount} = render(<Reader tick={0} />);

            expect(container.querySelector('.value')?.textContent).toEqual('1-none');
            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual([WILDCARD_PATH]);

            rerender(<Reader tick={1} />);

            // The read set is the wildcard again, unchanged from the first render, so the
            // subscription is not re-registered — but it must have been marked again: nothing
            // here may cache the non-trackable root's read past one render.
            expect(store.subscribeReads.length).toEqual(1);

            act(() => store.setKey('b', 2));

            // Had the second render's attempt gone unmarked, this write would never reach the
            // component: proof the wildcard was recorded again, not just remembered from render one.
            expect(container.querySelector('.value')?.textContent).toEqual('1-2');

            unmount();
        });
    });
