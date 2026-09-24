import {REACT_MAJOR, getCounterData, ObservedCarburetor, React, act, render, AntiHookComponent} from '../support';

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

            const original = console.error;
            const reported: string[] = [];

            console.error = (...args: unknown[]) => reported.push(args.map(String).join(' '));

            try {
                expect(() => render(<Boom />)).toThrow('boom');
            } finally {
                console.error = original;
            }

            // The attempt that threw is abandoned: what it collected is never published and no
            // subscription is installed for a component that never committed.
            expect(store.subscriberCount()).toEqual(0);
            expect(store.subscribeReads.length).toEqual(0);
            // React 19 retries an errored render once before propagating it: both attempts run
            // here, and both are abandoned. React 18's development replay doubles each attempt,
            // so a failed mount there runs four renders.
            expect(renders).toEqual(REACT_MAJOR >= 19 ? 2 : 4);
            // React 19 logs nothing for the uncaught throw; React 18 reports it with the
            // component stack it unwound through.
            if (REACT_MAJOR >= 19) {
                expect(reported.length).toEqual(0);
            } else {
                expect(reported.filter((message: string) =>
                    message.includes('The above error occurred in the <Boom> component')).length).toEqual(1);
            }
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
