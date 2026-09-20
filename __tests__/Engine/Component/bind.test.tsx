import * as React from 'react';
import {fireEvent, render} from '@testing-library/react';
import {AntiHookComponent, bind} from "@/Carburetor";

describe('@bind', () => {
    test('a bound method keeps its instance when it is called detached', () => {
        class Greeter {
            protected name: string = 'world';

            @bind
            public greet(): string {
                return `hello ${this.name}`;
            }
        }

        const greeter = new Greeter();
        const detached: () => string = greeter.greet;

        expect(detached()).toEqual('hello world');
    });

    test('the method stays on the prototype, so a subclass can call super', () => {
        class Base {
            @bind
            public describe(): string {
                return 'base';
            }
        }

        class Child extends Base {
            @bind
            public describe(): string {
                return `child of ${super.describe()}`;
            }
        }

        const child = new Child();
        const detached: () => string = child.describe;

        expect(Object.getPrototypeOf(new Base()).describe).toBeTruthy();
        expect(detached()).toEqual('child of base');
    });

    test('the bound reference is the same across renders, so the props gate still bails out', () => {
        let childRenders = 0;
        let parentRenders = 0;

        interface IChildProps {
            onPress: () => void;
        }

        class Child extends AntiHookComponent<IChildProps> {
            public render() {
                childRenders++;

                return <button className="child" onClick={this.props.onPress}>press</button>;
            }
        }

        class Parent extends AntiHookComponent<{}, {tick: number}> {
            public state = {tick: 0};

            @bind
            protected onPress(): void {
                this.setState({tick: this.state.tick + 1});
            }

            public render() {
                parentRenders++;

                return <div>
                    <span className="tick">{this.state.tick}</span>
                    <Child onPress={this.onPress}/>
                </div>;
            }
        }

        const {container} = render(<Parent/>);

        expect(parentRenders).toEqual(1);
        expect(childRenders).toEqual(1);

        fireEvent.click(container.querySelector('.child') as Element);

        expect(container.querySelector('.tick')?.textContent).toEqual('1');
        expect(parentRenders).toEqual(2);
        // The handler is the same function, so the child's props did not change.
        expect(childRenders).toEqual(1);
    });

    test('a handler bound in render defeats the props gate — the reason @bind exists', () => {
        let childRenders = 0;

        interface IChildProps {
            onPress: () => void;
        }

        class Child extends AntiHookComponent<IChildProps> {
            public render() {
                childRenders++;

                return <button className="child" onClick={this.props.onPress}>press</button>;
            }
        }

        class Parent extends AntiHookComponent<{}, {tick: number}> {
            public state = {tick: 0};

            protected onPress(): void {
                this.setState({tick: this.state.tick + 1});
            }

            public render() {
                return <div>
                    {/* The rule is right, and this test is what proves the consequence it warns about. */}
                    {/* oxlint-disable-next-line carburetor/no-handler-created-in-render */}
                    <Child onPress={this.onPress.bind(this)}/>
                </div>;
            }
        }

        const {container} = render(<Parent/>);

        expect(childRenders).toEqual(1);

        fireEvent.click(container.querySelector('.child') as Element);

        // A fresh function every render: the props compare as changed and the child re-renders.
        expect(childRenders).toEqual(2);
    });

    test('applying it to something that is not a method is reported', () => {
        const applyToField = () => {
            // The type system rejects this; JS callers and casts reach the runtime guard.
            const decorate = bind as unknown as (
                value: unknown,
                context: {kind: string; name: string}
            ) => void;

            decorate(() => undefined, {kind: 'field', name: 'handler'});
        };

        expect(applyToField).toThrow('methods');
    });
});
