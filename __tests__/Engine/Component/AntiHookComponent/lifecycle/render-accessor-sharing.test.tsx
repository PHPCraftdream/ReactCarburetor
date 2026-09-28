import {getCounterData, CounterCarburetor, React, act, render, AntiHookComponent} from '../support';

describe('render accessor sharing', () => {
    test('two instances of the same subclass share the render accessor\'s getter and setter', () => {
        // Direct construction, no DOM: only the descriptor `installRenderBoundary` installs
        // matters here. A fresh closure pair per instance — the pre-fix shape — would fail
        // this by construction, since two closures are never `===`.
        class Plain extends AntiHookComponent {
            public render(): React.ReactNode {
                return null;
            }
        }

        const first = new Plain({} as never);
        const second = new Plain({} as never);

        const firstDescriptor = Object.getOwnPropertyDescriptor(first, 'render');
        const secondDescriptor = Object.getOwnPropertyDescriptor(second, 'render');

        expect(typeof firstDescriptor?.get).toEqual('function');
        expect(typeof firstDescriptor?.set).toEqual('function');
        expect(firstDescriptor?.get).toBe(secondDescriptor?.get);
        expect(firstDescriptor?.set).toBe(secondDescriptor?.set);
    });

    test('an unrelated subclass shares the same getter and setter too', () => {
        // The getter/setter live once on the base class, not per leaf class, so two completely
        // different subclasses still see the same pair.
        class First extends AntiHookComponent {
            public render(): React.ReactNode {
                return null;
            }
        }

        class Second extends AntiHookComponent {
            public render(): React.ReactNode {
                return null;
            }
        }

        const a = Object.getOwnPropertyDescriptor(new First({} as never), 'render');
        const b = Object.getOwnPropertyDescriptor(new Second({} as never), 'render');

        expect(a?.get).toBe(b?.get);
        expect(a?.set).toBe(b?.set);
    });

    test('a subclass member named like the accessor functions cannot replace them', () => {
        const store = new CounterCarburetor(getCounterData());

        class Shadowing extends AntiHookComponent {
            private readonly view = this.connect(() => store);

            public renderGetter(): string {
                return 'not the accessor';
            }

            public render(): React.ReactNode {
                return <span data-testid="shadowing">{this.view.value}</span>;
            }
        }

        const view = render(<Shadowing />);

        act(() => store.incValue());

        expect(view.getByTestId('shadowing').textContent).toEqual("1");
        view.unmount();
    });

    test('reassigning render after mount rebuilds the boundary and renders the new function', () => {
        const store = new CounterCarburetor(getCounterData());
        let firstRenders = 0;
        let secondRenders = 0;

        class Reassignable extends AntiHookComponent {
            private readonly view = this.connect(() => store);

            public constructor(props: Readonly<object>) {
                super(props);

                this.render = (): React.ReactNode => {
                    firstRenders++;

                    return <div className="value">first:{this.view.value}</div>;
                };
            }

            public switchRender(): void {
                this.render = (): React.ReactNode => {
                    secondRenders++;

                    return <div className="value">second:{this.view.value}</div>;
                };
                this.forceUpdate();
            }
        }

        const ref = React.createRef<Reassignable>();
        const {container, unmount} = render(<Reassignable ref={ref} />);

        expect(container.querySelector('.value')?.textContent).toEqual('first:0');
        expect(firstRenders).toEqual(1);

        act(() => ref.current?.switchRender());

        expect(container.querySelector('.value')?.textContent).toEqual('second:0');
        expect(secondRenders).toEqual(1);
        // The old boundary never runs again once render was reassigned.
        expect(firstRenders).toEqual(1);

        act(() => store.incValue());

        expect(container.querySelector('.value')?.textContent).toEqual('second:1');
        expect(secondRenders).toEqual(2);

        unmount();
    });

    test('a render override two levels deep gets its own boundary and keeps tracking reads', () => {
        const store = new CounterCarburetor(getCounterData());

        class Base extends AntiHookComponent {
            protected readonly view = this.connect(() => store);

            public render(): React.ReactNode {
                return <div className="value">base:{this.view.value}</div>;
            }
        }

        class Mid extends Base {
        }

        class Grandchild extends Mid {
            public render(): React.ReactNode {
                return <div className="value">grand:{this.view.value}</div>;
            }
        }

        const {container, unmount} = render(<Grandchild />);

        expect(container.querySelector('.value')?.textContent).toEqual('grand:0');
        expect(store.subscriberCount()).toEqual(1);

        act(() => store.incValue());

        expect(container.querySelector('.value')?.textContent).toEqual('grand:1');

        unmount();

        expect(store.subscriberCount()).toEqual(0);
    });
});
