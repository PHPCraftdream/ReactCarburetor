import {getCounterData, ObservedCarburetor, React, act, render, AntiHookComponent} from '../support';

    describe('render definition and modern lifecycle APIs (R2-04)', () => {
        type TModernLifecycle = 'none' | 'derived' | 'snapshot';

        // One fresh class per call, written the way a user writes it: the combination of
        // render definition style and modern lifecycle API is the defect surface of R2-04 —
        // React skips mount lifecycle hooks for components that define
        // getDerivedStateFromProps or getSnapshotBeforeUpdate, so a boundary installed by a
        // mount hook silently never runs for those.
        const buildComponent = (
            store: ObservedCarburetor,
            fieldRender: boolean,
            modern: TModernLifecycle,
            countRender: () => void
        ): typeof AntiHookComponent => {
            if (!fieldRender) {
                if (modern === 'none') {
                    class MethodPlain extends AntiHookComponent {
                        private readonly view = this.connect(() => store);

                        public render(): React.ReactNode {
                            countRender();

                            return <div className="value">{this.view.value}</div>;
                        }
                    }

                    return MethodPlain;
                }

                if (modern === 'derived') {
                    class MethodDerived extends AntiHookComponent {
                        // An object, not null: React warns about getDerivedStateFromProps with
                        // a null initial state.
                        public state = {};

                        private readonly view = this.connect(() => store);

                        public static getDerivedStateFromProps(): null {
                            return null;
                        }

                        public render(): React.ReactNode {
                            countRender();

                            return <div className="value">{this.view.value}</div>;
                        }
                    }

                    return MethodDerived;
                }

                class MethodSnapshot extends AntiHookComponent {
                    private readonly view = this.connect(() => store);

                    public getSnapshotBeforeUpdate(): null {
                        return null;
                    }

                    public componentDidUpdate(previousProps: Readonly<Record<string, never>>): void {
                        super.componentDidUpdate(previousProps);
                    }

                    public render(): React.ReactNode {
                        countRender();

                        return <div className="value">{this.view.value}</div>;
                    }
                }

                return MethodSnapshot;
            }

            if (modern === 'none') {
                class FieldPlain extends AntiHookComponent {
                    private readonly view = this.connect(() => store);

                    // oxlint-disable-next-line carburetor/no-lifecycle-class-property
                    render = (): React.ReactNode => {
                        countRender();

                        return <div className="value">{this.view.value}</div>;
                    };
                }

                return FieldPlain;
            }

            if (modern === 'derived') {
                class FieldDerived extends AntiHookComponent {
                    public state = {};

                    private readonly view = this.connect(() => store);

                    public static getDerivedStateFromProps(): null {
                        return null;
                    }

                    // oxlint-disable-next-line carburetor/no-lifecycle-class-property
                    render = (): React.ReactNode => {
                        countRender();

                        return <div className="value">{this.view.value}</div>;
                    };
                }

                return FieldDerived;
            }

            class FieldSnapshot extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                public getSnapshotBeforeUpdate(): null {
                    return null;
                }

                public componentDidUpdate(previousProps: Readonly<Record<string, never>>): void {
                    super.componentDidUpdate(previousProps);
                }

                // oxlint-disable-next-line carburetor/no-lifecycle-class-property
                render = (): React.ReactNode => {
                    countRender();

                    return <div className="value">{this.view.value}</div>;
                };
            }

            return FieldSnapshot;
        };

        for (const fieldRender of [false, true]) {
            for (const modern of ['none', 'derived', 'snapshot'] as const) {
                const shape = fieldRender ? 'class-field' : 'prototype-method';
                const label = modern === 'none' ? 'no modern lifecycle API' : modern;

                test(`a ${shape} render with ${label} is tracked from the first mount`, () => {
                    const store = new ObservedCarburetor(getCounterData());
                    let renders = 0;
                    const Component = buildComponent(store, fieldRender, modern, () => {
                        renders++;
                    });
                    const {container, unmount} = render(<Component />);

                    expect(store.subscriberCount()).toEqual(1);
                    expect(container.querySelector('.value')?.textContent).toEqual('0');
                    // The boundary was already in place for the first render: tracking never
                    // needed a second render to catch up.
                    expect(renders).toEqual(1);

                    act(() => store.incValue());

                    expect(container.querySelector('.value')?.textContent).toEqual('1');

                    unmount();

                    expect(store.subscriberCount()).toEqual(0);
                });

                test(`a ${shape} render with ${label} is tracked under StrictMode`, () => {
                    const store = new ObservedCarburetor(getCounterData());
                    const Component = buildComponent(store, fieldRender, modern, () => undefined);
                    const {container, unmount} = render(<React.StrictMode><Component /></React.StrictMode>);

                    expect(store.subscriberCount()).toEqual(1);

                    act(() => store.incValue());

                    expect(container.querySelector('.value')?.textContent).toEqual('1');

                    unmount();

                    expect(store.subscriberCount()).toEqual(0);
                });
            }
        }

        test('a render assigned in the constructor body is wrapped at assignment time', () => {
            const store = new ObservedCarburetor(getCounterData());
            let renders = 0;

            class Assigned extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                public constructor(props: Readonly<object>) {
                    super(props);

                    this.render = (): React.ReactNode => {
                        renders++;

                        return <div className="value">{this.view.value}</div>;
                    };
                }
            }

            const {container, unmount} = render(<Assigned />);

            expect(store.subscriberCount()).toEqual(1);
            expect(container.querySelector('.value')?.textContent).toEqual('0');
            expect(renders).toEqual(1);

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            unmount();

            expect(store.subscriberCount()).toEqual(0);
        });
    });
