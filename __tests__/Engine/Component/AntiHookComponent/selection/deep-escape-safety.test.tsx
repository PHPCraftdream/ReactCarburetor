import {React, act, render, AntiHookComponent, Carburetor} from '../support';

    describe('connectSelection deep escape safety (R3-02)', () => {
        class ProfileCarburetor extends Carburetor<{profile: {name: string}}> {
            public subscriberCount = (): number => Object.keys(this.subscribers).length;

            /** A leaf write: the exact write shape the finding's reproduction depends on. */
            public renameProfile = (name: string): void => {
                this.draft.profile.name = name;
                this.emitUpdate();
            };
        }

        const getProfileData = (): {profile: {name: string}} => ({profile: {name: 'Ann'}});

        test('a nested selected branch wakes a memo child after a leaf write', () => {
            const store = new ProfileCarburetor(getProfileData());
            let memoRenders = 0;

            const MemoChild = React.memo(({model}: {model: {wrapper: {user: {name: string}}}}) => {
                memoRenders++;

                return <span className="memo-name">{model.wrapper.user.name}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly selected = this.connectSelection(
                    () => store,
                    (data) => ({wrapper: {user: data.profile}})
                );

                render() {
                    return <MemoChild model={this.selected()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-name')?.textContent).toEqual('Ann');
            act(() => store.renameProfile('Bob'));
            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-name')?.textContent).toEqual('Bob');

            unmount();
        });

        test('an array member selected through a view wakes its memo child after a leaf write', () => {
            const store = new ProfileCarburetor(getProfileData());
            let memoRenders = 0;

            const MemoChild = React.memo(({rows}: {rows: Array<{name: string}>}) => {
                memoRenders++;

                return <span className="memo-row">{rows[0].name}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly selected = this.connectSelection(() => store, (data) => ({rows: [data.profile]}));

                render() {
                    return <MemoChild rows={this.selected().rows} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-row')?.textContent).toEqual('Ann');
            act(() => store.renameProfile('Bob'));
            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-row')?.textContent).toEqual('Bob');

            unmount();
        });

        test('a symbol-keyed selected branch is not part of a selection (R30-04)', () => {
            const store = new ProfileCarburetor(getProfileData());
            const SYM_PROFILE = Symbol('r30-04/profile');

            let memoRenders = 0;

            const MemoChild = React.memo(({model}: {model: Record<PropertyKey, unknown>}) => {
                memoRenders++;

                return <span className="memo-sym">
                    {String((model[SYM_PROFILE] as {name: string} | undefined) === undefined)}
                </span>;
            });

            class Parent extends AntiHookComponent {
                private readonly selected = this.connectSelection(
                    () => store,
                    (data) => ({[SYM_PROFILE]: data.profile})
                );

                render() {
                    return <MemoChild model={this.selected()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-sym')?.textContent).toEqual('true');
            act(() => store.renameProfile('Bob'));
            // The symbol member was never copied, so the child stays at its bail-out.
            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-sym')?.textContent).toEqual('true');

            unmount();
        });

        test('an opaque root facade still reports a live escape and strands a gated child', async () => {
            class OpaqueProfile {
                public constructor(public name: string) {}
            }

            const store = new Carburetor(new OpaqueProfile('Ann'));
            const Child = React.memo(({model}: {model: OpaqueProfile}) =>
                <span className="opaque-profile">{model.name}</span>
            );
            class Parent extends AntiHookComponent {
                private readonly selected = this.connectSelection(() => store, data => ({model: data}));

                render() {
                    return <Child model={this.selected().model} />;
                }
            }

            const original = console.error;
            const reported: string[] = [];
            let mounted: {container: HTMLElement; unmount: () => void} | undefined;
            console.error = (message: string) => { reported.push(message); };

            try {
                mounted = render(<Parent />);
                expect(mounted.container.querySelector('.opaque-profile')?.textContent).toBe('Ann');

                await act(async () => { store.setData(new OpaqueProfile('Bob')); });
                expect(store.getData().name).toBe('Bob');
                expect(mounted.container.querySelector('.opaque-profile')?.textContent).toBe('Ann');
                expect(reported).toHaveLength(1);
            } finally {
                mounted?.unmount();
                console.error = original;
            }
        });

        test('a cyclic plain container in the selection does not overflow the stack (R3-02)', () => {
            const store = new ProfileCarburetor(getProfileData());

            class CyclicParent extends AntiHookComponent {
                public readonly selected = this.connectSelection(() => store, (data) => {
                    const shape: {name: string; self?: unknown} = {name: data.profile.name};

                    shape.self = shape;

                    return shape;
                });

                render() {
                    return <span className="cyclic">{(this.selected() as {name: string}).name}</span>;
                }
            }

            const instance = new CyclicParent({} as never);
            let first: {name: string; self: unknown} | undefined;

            expect(() => {
                first = instance.selected() as {name: string; self: unknown};
            }).not.toThrow();

            expect(first?.name).toEqual('Ann');
            // The cycle survives detachment: the copy's own "self" key points at the copy
            // itself, not at the raw selection object or at undefined.
            expect(first?.self).toBe(first);

            const {container, unmount} = render(<CyclicParent />);

            expect(container.querySelector('.cyclic')?.textContent).toEqual('Ann');

            unmount();
        });

        test('an ordinary flat selection still detaches and compares as before (regression guard)', () => {
            const store = new ProfileCarburetor(getProfileData());
            let memoRenders = 0;

            const MemoChild = React.memo(({name}: {name: string}) => {
                memoRenders++;

                return <span className="memo-flat">{name}</span>;
            });

            class Parent extends AntiHookComponent<{flag?: string}> {
                private readonly selected = this.connectSelection(() => store, (data) => ({name: data.profile.name}));

                render() {
                    return <MemoChild name={this.selected().name} />;
                }
            }

            const {container, rerender, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-flat')?.textContent).toEqual('Ann');
            expect(memoRenders).toEqual(1);

            // An unrelated re-render: the flat selection's identity is stable, so the memoized
            // child keeps its bail-out — the one-level comparison contract is unaffected.
            rerender(<Parent flag="x" />);
            expect(memoRenders).toEqual(1);

            act(() => store.renameProfile('Bob'));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-flat')?.textContent).toEqual('Bob');

            unmount();
        });
    });
