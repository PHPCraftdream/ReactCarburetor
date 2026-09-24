import {
    getCounterData, ObservedCarburetor, getTodoData, ListCarburetor,
    act, rstest, fireEvent, render, AntiHookComponent,
} from '../support';

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
