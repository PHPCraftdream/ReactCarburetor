import {getCounterData, ObservedCarburetor, act, fireEvent, render, AntiHookComponent} from '../support';

describe('connect', () => {
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

});
