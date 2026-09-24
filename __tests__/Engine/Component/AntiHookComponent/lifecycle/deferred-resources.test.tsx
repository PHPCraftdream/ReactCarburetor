import {makeLoader, flush, React, act, render, AntiHookComponent, EResourceStatus, ResourceCache} from '../support';

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
