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

        test('a live view nested two levels inside a plain object reaches the memo child after a ' +
            'leaf write, and the escape is still reported (bounded reproduction)', () => {
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

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const {container, unmount} = render(<Parent />);

                expect(container.querySelector('.memo-name')?.textContent).toEqual('Ann');

                // The leaf write that stranded the nested live view before the fix: the owner's
                // subscription must now be precise enough to wake on it.
                act(() => store.renameProfile('Bob'));

                expect(memoRenders).toEqual(2);
                expect(container.querySelector('.memo-name')?.textContent).toEqual('Bob');

                unmount();
            } finally {
                console.error = original;
            }

            // Still flagged as an API-contract mistake even though the fix makes it safe: the
            // report is informational, not a correctness gate.
            expect(reported.filter((message) => message.includes('connectSelection()')).length).toEqual(1);
        });

        test('a live view nested inside an array element reaches the memo child after a leaf write (R3-02)', () => {
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

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const {container, unmount} = render(<Parent />);

                expect(container.querySelector('.memo-row')?.textContent).toEqual('Ann');

                act(() => store.renameProfile('Bob'));

                expect(memoRenders).toEqual(2);
                expect(container.querySelector('.memo-row')?.textContent).toEqual('Bob');

                unmount();
            } finally {
                console.error = original;
            }

            expect(reported.filter((message) => message.includes('connectSelection()')).length).toEqual(1);
        });

        test('a live view reachable only through an enumerable symbol key is detected and detached (R3-02)', () => {
            const store = new ProfileCarburetor(getProfileData());
            const SYM_PROFILE = Symbol('r3-02/profile');

            let memoRenders = 0;

            const MemoChild = React.memo(({model}: {model: Record<PropertyKey, unknown>}) => {
                memoRenders++;

                return <span className="memo-sym">{(model[SYM_PROFILE] as {name: string}).name}</span>;
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

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const {container, unmount} = render(<Parent />);

                expect(container.querySelector('.memo-sym')?.textContent).toEqual('Ann');

                act(() => store.renameProfile('Bob'));

                expect(memoRenders).toEqual(2);
                expect(container.querySelector('.memo-sym')?.textContent).toEqual('Bob');

                unmount();
            } finally {
                console.error = original;
            }

            expect(reported.filter((message) => message.includes('connectSelection()')).length).toEqual(1);
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
