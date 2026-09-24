import {getCounterData, CounterCarburetor, React, render, AntiHookComponent} from '../support';

    describe('throwing teardowns (R2-09)', () => {
        test('a throwing effect cleanup still unmounts the rest and releases the subscription', () => {
            const log: string[] = [];
            const store = new CounterCarburetor(getCounterData());
            const closeA = (): void => {
                log.push('close:a');

                throw new Error('cleanup a failed');
            };
            const closeB = (): void => {
                log.push('close:b');
            };

            class TwoCleanups extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(
                        () => {
                            log.push('open:a');

                            return closeA;
                        },
                        'a',
                        []
                    );

                    this.useEffect(
                        () => {
                            log.push('open:b');

                            return closeB;
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
            const closeA = (): void => {
                log.push('close:a');
            };

            class BrokenTeardown extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => {
                        log.push('open:a');

                        return closeA;
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
            const closeChannel = (channel: string): void => {
                log.push('close:' + channel);

                if (channel === 'a') {
                    throw new Error('cleanup a failed');
                }
            };

            class Channel extends AntiHookComponent<{channel: string}> {
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
            const cleanup = (): void => {
                log.push('cleanup');
            };

            class BrokenSetup extends AntiHookComponent<{fail: boolean}> {
                protected useEffects(): void {
                    this.useEffect(
                        () => {
                            if (this.props.fail) {
                                throw new Error('setup failed');
                            }

                            log.push('open');

                            return cleanup;
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
            const cleanup = (): void => {
                log.push('cleanup');

                throw new Error('cleanup failed');
            };

            class Both extends AntiHookComponent<{fail: boolean}> {
                protected useEffects(): void {
                    this.useEffect(
                        () => {
                            if (this.props.fail) {
                                throw new Error('setup failed');
                            }

                            log.push('open');

                            return cleanup;
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
