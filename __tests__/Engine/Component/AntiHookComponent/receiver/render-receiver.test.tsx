import {getCounterData, CounterCarburetor, React, act, fireEvent, render, AntiHookComponent} from '../support';

describe('', () => {
    describe('render receiver (R3-01)', () => {
        test('direct construction: a prototype render and an ordinary method observe the same ' +
            'private field (bounded reproduction)', () => {
            class PrivateView extends AntiHookComponent {
                #value = 7;

                read() {
                    return this.#value;
                }

                render() {
                    return this.#value;
                }
            }

            const view = new PrivateView({} as never);

            expect(view.read()).toEqual(7);
            // Before the fix this threw: "Cannot read private member #value from an object
            // whose class did not declare it" — render ran with the original base instance as
            // `this`, not the proxy the constructor actually returned and #value was installed on.
            expect(view.render()).toEqual(7);
        });

        test('a prototype render method reads its own private field through a real mount', () => {
            class PrivateView extends AntiHookComponent {
                #value = 7;

                render() {
                    return <div className="value">{this.#value}</div>;
                }
            }

            const {container, unmount} = render(<PrivateView />);

            expect(container.querySelector('.value')?.textContent).toEqual('7');

            unmount();
        });

        test('a prototype render method calls its own private method through a real mount', () => {
            class PrivateMethodView extends AntiHookComponent {
                #secret = 3;

                #double() {
                    return this.#secret * 2;
                }

                render() {
                    return <div className="value">{this.#double()}</div>;
                }
            }

            const {container, unmount} = render(<PrivateMethodView />);

            expect(container.querySelector('.value')?.textContent).toEqual('6');

            unmount();
        });

        test('a private field and a private method both survive across re-renders driven by a store write', () => {
            const store = new CounterCarburetor(getCounterData());

            class PrivateCounter extends AntiHookComponent {
                #label = 'count';

                #describe(value: number): string {
                    return this.#label + ':' + value;
                }

                render() {
                    const {value} = this.useCarburetor(store);

                    return <div className="value">{this.#describe(value)}</div>;
                }
            }

            const {container, unmount} = render(<PrivateCounter />);

            expect(container.querySelector('.value')?.textContent).toEqual('count:0');

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('count:1');

            unmount();
        });

        test('a class-field arrow render also reads a private field (control: unaffected by the receiver bug)', () => {
            class ArrowPrivateView extends AntiHookComponent {
                #value = 9;

                // oxlint-disable-next-line carburetor/no-lifecycle-class-property
                render = () => <div className="value">{this.#value}</div>;
            }

            const {container, unmount} = render(<ArrowPrivateView />);

            expect(container.querySelector('.value')?.textContent).toEqual('9');

            unmount();
        });

        test('a component ref and an inner DOM ref both resolve through the render boundary', () => {
            class RefView extends AntiHookComponent {
                #tag = 'boxed';
                public readonly boxRef = React.createRef<HTMLDivElement>();

                render() {
                    return <div ref={this.boxRef} className={this.#tag}>hi</div>;
                }
            }

            const componentRef = React.createRef<RefView>();
            const {container, unmount} = render(<RefView ref={componentRef} />);

            expect(componentRef.current).toBeInstanceOf(RefView);
            expect(componentRef.current?.boxRef.current).toBe(container.querySelector('.boxed'));

            unmount();
        });

        test('an inherited render method (a subclass of a subclass) still reads the base ' +
            'class\'s private field', () => {
            class PrivateBase extends AntiHookComponent {
                #value = 42;

                render() {
                    return <div className="value">{this.#value}</div>;
                }
            }

            class PrivateGrandchild extends PrivateBase {
            }

            const {container, unmount} = render(<PrivateGrandchild />);

            expect(container.querySelector('.value')?.textContent).toEqual('42');

            unmount();
        });

        test('StrictMode double-invoking render does not trip the private-field receiver check', () => {
            class PrivateStrict extends AntiHookComponent {
                #value = 5;

                render() {
                    return <div className="value">{this.#value}</div>;
                }
            }

            const {container, unmount} = render(<React.StrictMode><PrivateStrict /></React.StrictMode>);

            expect(container.querySelector('.value')?.textContent).toEqual('5');

            unmount();
        });
    });

    describe('instance proxy accessor receiver (R4-01)', () => {
        test('a native private getter and setter both work when called from render', () => {
            class AccessorView extends AntiHookComponent {
                #value = 7;

                get amount(): number {
                    return this.#value;
                }

                set amount(next: number) {
                    this.#value = next;
                }

                render() {
                    // Before the fix, reading/assigning `amount` here threw: the ordinary get/set
                    // traps forwarded to Reflect.get/Reflect.set with the raw target as receiver,
                    // so the getter/setter body's `this.#value` failed the private-brand check.
                    // `amount` is a data accessor, not a callback the rule below is meant to catch.
                    // oxlint-disable-next-line carburetor/require-bind-for-passed-method
                    this.amount = this.amount + 1;

                    // oxlint-disable-next-line carburetor/require-bind-for-passed-method
                    return <div className="value">{this.amount}</div>;
                }
            }

            const {container, unmount} = render(<AccessorView />);

            expect(container.querySelector('.value')?.textContent).toEqual('8');

            unmount();
        });

        test('a native private getter and setter both work when called from an event handler', () => {
            class AccessorHandler extends AntiHookComponent {
                #value = 1;

                get amount(): number {
                    return this.#value;
                }

                set amount(next: number) {
                    this.#value = next;
                }

                handleClick = (): void => {
                    // `amount` is a data accessor, not a callback: see the render() note above.
                    // oxlint-disable-next-line carburetor/require-bind-for-passed-method
                    this.amount = this.amount + 1;
                    this.forceUpdate();
                };

                render() {
                    return <div>
                        {/* oxlint-disable-next-line carburetor/require-bind-for-passed-method */}
                        <div className="value">{this.amount}</div>
                        <button className="btn" onClick={this.handleClick}>inc</button>
                    </div>;
                }
            }

            const {container, unmount} = render(<AccessorHandler />);

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            fireEvent.click(container.querySelector('.btn') as HTMLButtonElement);

            expect(container.querySelector('.value')?.textContent).toEqual('2');

            unmount();
        });

        test('an inherited getter/setter declared on an intermediate class still sees the ' +
            'right receiver', () => {
            class AccessorBase extends AntiHookComponent {
                #value = 3;

                get amount(): number {
                    return this.#value;
                }

                set amount(next: number) {
                    this.#value = next;
                }
            }

            class AccessorMid extends AccessorBase {
            }

            class AccessorLeaf extends AccessorMid {
                handleClick = (): void => {
                    this.amount = this.amount + 10;
                    this.forceUpdate();
                };

                render() {
                    return <div>
                        <div className="value">{this.amount}</div>
                        <button className="btn" onClick={this.handleClick}>inc</button>
                    </div>;
                }
            }

            const {container, unmount} = render(<AccessorLeaf />);

            expect(container.querySelector('.value')?.textContent).toEqual('3');

            fireEvent.click(container.querySelector('.btn') as HTMLButtonElement);

            expect(container.querySelector('.value')?.textContent).toEqual('13');

            unmount();
        });

        test('a method bound to the instance still reaches its private field', () => {
            class BoundMethodView extends AntiHookComponent {
                #value = 11;

                read(): number {
                    return this.#value;
                }

                render() {
                    const bound = this.read.bind(this);

                    return <div className="value">{bound()}</div>;
                }
            }

            const {container, unmount} = render(<BoundMethodView />);

            expect(container.querySelector('.value')?.textContent).toEqual('11');

            unmount();
        });

        test('props, state and setState still behave normally on a component with a private accessor', () => {
            const store = new CounterCarburetor(getCounterData());

            interface IAccessorProps {
                label: string;
            }

            interface IAccessorState {
                count: number;
            }

            class StatefulAccessor extends AntiHookComponent<IAccessorProps, IAccessorState> {
                public state: IAccessorState = {count: 0};

                #label = 'x';

                get label(): string {
                    return this.#label;
                }

                set label(next: string) {
                    this.#label = next;
                }

                handleClick = (): void => {
                    this.label = 'y';
                    this.setState({count: this.state.count + 1});
                };

                render() {
                    const {value} = this.useCarburetor(store);

                    return <div>
                        <div className="value">
                            {/* `label` is a data accessor, not a callback. */}
                            {/* oxlint-disable-next-line carburetor/require-bind-for-passed-method */}
                            {this.props.label}:{this.label}:{this.state.count}:{value}
                        </div>
                        <button className="btn" onClick={this.handleClick}>go</button>
                    </div>;
                }
            }

            const {container, rerender, unmount} = render(<StatefulAccessor label="a" />);

            expect(container.querySelector('.value')?.textContent).toEqual('a:x:0:0');

            fireEvent.click(container.querySelector('.btn') as HTMLButtonElement);

            expect(container.querySelector('.value')?.textContent).toEqual('a:y:1:0');

            rerender(<StatefulAccessor label="b" />);

            expect(container.querySelector('.value')?.textContent).toEqual('b:y:1:0');

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('b:y:1:1');

            unmount();
        });
    });

});
