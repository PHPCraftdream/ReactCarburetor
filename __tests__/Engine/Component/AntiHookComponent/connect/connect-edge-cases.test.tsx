import {
    REACT_MAJOR, getCounterData, CounterCarburetor, ObservedCarburetor,
    React, act, render, AntiHookComponent, Carburetor, CarburetorProvider,
    CarburetorScope, ScopedAntiHookComponent, carburetorToken,
} from '../support';

describe('connect', () => {
        test('a frozen branch is refused with the engine boundary error', () => {
            const store = new Carburetor<{nested: {deep: number}}>(
                Object.freeze({nested: Object.freeze({deep: 1})})
            );

            class FrozenBranch extends AntiHookComponent {
                public readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.nested.deep}</div>;
                }
            }

            const instance = new FrozenBranch({} as never);

            expect(() => instance.view.nested).toThrow('non-configurable');
        });

        test('mutation attempts are rejected and never poison later reads', () => {
            const store = new CounterCarburetor(getCounterData());

            class Counter extends AntiHookComponent {
                public readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, unmount} = render(<Counter />);
            const instance = new Counter({} as never);
            const view = instance.view as unknown as {value: number; other?: number};

            expect(() => {
                view.value = 5;
            }).toThrow('read-only');
            expect(() => {
                delete view.other;
            }).toThrow('read-only');
            expect(() => {
                Object.defineProperty(view, 'value', {value: 9, writable: true, enumerable: true, configurable: true});
            }).toThrow('read-only');
            expect(() => {
                Object.setPrototypeOf(view, {injected: () => 1});
            }).toThrow();
            expect(() => {
                Object.preventExtensions(view);
            }).toThrow();
            expect(Object.isExtensible(view)).toBe(true);
            expect(Object.getPrototypeOf(view)).toBe(Object.prototype);

            expect(store.getData()).toEqual({value: 0, other: 0});

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            unmount();
        });

        test('nested views behind connect() refuse structural mutation (R2-12)', () => {
            class NameCarburetor extends Carburetor<{user: {name: string}}> {
                public rename = (name: string): void => {
                    this.draft.user.name = name;

                    this.emitUpdate();
                };
            }

            const store = new NameCarburetor({user: {name: 'first'}});

            class UserView extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="name">{this.view.user.name}</div>;
                }
            }

            const {container, unmount} = render(<UserView />);

            expect(container.querySelector('.name')?.textContent).toEqual('first');

            const instance = new UserView({} as never);
            const nested = (instance as unknown as {view: {user: {name: string}}}).view.user;
            const rawUser = store.getData().user;

            // The facade's own traps already reject these, but a branch reached through it is
            // an ordinary read proxy from createReadProxy: it must refuse them too, against the
            // raw backing object rather than some copy.
            expect(() => {
                Object.setPrototypeOf(nested, null);
            }).toThrow(/read-only/);
            expect(Object.getPrototypeOf(rawUser)).toBe(Object.prototype);

            expect(() => {
                Object.preventExtensions(nested);
            }).toThrow(/read-only/);
            expect(Object.isExtensible(rawUser)).toBe(true);

            act(() => store.rename('second'));

            // A legitimate draft write still reaches the rendered output.
            expect(container.querySelector('.name')?.textContent).toEqual('second');

            unmount();
        });

        test('restore() keeps the view live on the restored data', () => {
            const store = new CounterCarburetor({value: 5, other: 0});
            const snapshot = store.snapshot();

            class Counter extends AntiHookComponent {
                private readonly view = this.connect(() => store);

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const {container, unmount} = render(<Counter />);

            expect(container.querySelector('.value')?.textContent).toEqual('5');

            act(() => store.incValue());

            expect(container.querySelector('.value')?.textContent).toEqual('6');

            act(() => {
                store.restore(snapshot);
            });

            expect(container.querySelector('.value')?.textContent).toEqual('5');

            unmount();
        });

        test('a scope-backed resolver connects without subscribing during construction', () => {
            const token = carburetorToken<ObservedCarburetor>(
                () => new ObservedCarburetor(getCounterData()),
                'js03/connect/counter'
            );

            class ScopedCounter extends ScopedAntiHookComponent {
                private readonly view = this.connect(() => this.resolve(token));

                render() {
                    return <div className="value">{this.view.value}</div>;
                }
            }

            const scope = new CarburetorScope();
            const store = scope.get(token);

            // Constructed outside any provider: the resolver cannot resolve yet, the
            // declaration must swallow that quietly, and nothing may subscribe.
            const uncommitted = new ScopedCounter({} as never);

            expect(store.subscriberCount()).toEqual(0);

            const {container, unmount} = render(
                <CarburetorProvider scope={scope}>
                    <ScopedCounter />
                </CarburetorProvider>
            );

            expect(container.querySelector('.value')?.textContent).toEqual('0');

            act(() => {
                store.incValue();
            });

            expect(container.querySelector('.value')?.textContent).toEqual('1');
            expect(store.subscribeReads.length).toEqual(1);
            expect([...store.subscribeReads[0]]).toEqual(['value']);

            unmount();

            expect(store.subscriberCount()).toEqual(0);
            expect(uncommitted).toBeDefined();
        });

        test('an array root behind a scope-backed resolver fails loudly, not with a wrong view', () => {
            const token = carburetorToken<Carburetor<Array<{id: number}>>>(
                () => new Carburetor<Array<{id: number}>>([{id: 1}]),
                'js03/connect/array'
            );

            class ScopedList extends ScopedAntiHookComponent {
                private readonly view = this.connect(() => this.resolve(token));

                render() {
                    return <div className="value">{this.view[0].id}</div>;
                }
            }

            const scope = new CarburetorScope();

            const original = console.error;
            const reported: string[] = [];

            console.error = (...args: unknown[]) => reported.push(args.map(String).join(' '));

            try {
                expect(() => {
                    render(
                        <CarburetorProvider scope={scope}>
                            <ScopedList />
                        </CarburetorProvider>
                    );
                }).toThrow('array');
            } finally {
                console.error = original;
            }

            // React 19 logs nothing for the uncaught throw; React 18 reports it with the
            // component stack it unwound through.
            if (REACT_MAJOR >= 19) {
                expect(reported.length).toEqual(0);
            } else {
                expect(reported.filter((message: string) =>
                    message.includes('The above error occurred in the <ScopedList> component')).length).toEqual(1);
            }
        });

        test('a source() swap that changes the root kind fails loudly instead of serving a mixed view', () => {
            const arrayStore = new Carburetor<Array<{id: number}>>([{id: 1}]);
            const objectStore = new Carburetor<{value: number}>({value: 0});

            class Swapper extends AntiHookComponent<{useArray: boolean}> {
                private readonly view = this.connect(() => (this.props.useArray ? arrayStore : objectStore));

                render() {
                    const values = this.view as ReadonlyArray<{id: number}>;

                    return <div className="value">{values.length}</div>;
                }
            }

            const {container, rerender, unmount} = render(<Swapper useArray={true} />);

            expect(container.querySelector('.value')?.textContent).toEqual('1');

            const original = console.error;
            const reported: string[] = [];

            console.error = (...args: unknown[]) => reported.push(args.map(String).join(' '));

            try {
                expect(() => rerender(<Swapper useArray={false} />)).toThrow('kind');
            } finally {
                console.error = original;
            }

            // React 19 logs nothing for the uncaught throw; React 18 reports it with the
            // component stack it unwound through.
            if (REACT_MAJOR >= 19) {
                expect(reported.length).toEqual(0);
            } else {
                expect(reported.filter((message: string) =>
                    message.includes('The above error occurred in the <Swapper> component')).length).toEqual(1);
            }

            unmount();
        });
});
