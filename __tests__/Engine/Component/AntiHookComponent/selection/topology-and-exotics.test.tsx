import {React, act, render, AntiHookComponent, Carburetor, TReadonly} from '../support';

    describe('connectSelection topology and exotic members (R5-01, R5-02)', () => {
        interface IShareData {
            share: boolean;
            left: {v: number};
            right: {v: number};
        }

        class ShareCarburetor extends Carburetor<IShareData> {
            public setShare = (share: boolean): void => {
                this.update((draft: IShareData): void => {
                    draft.share = share;
                });
            };
        }

        // The review's selector shape: while `share` is true both keys read `data.left`, so one
        // branch — and after detachment one copy — lands behind both keys; while it is false,
        // two branches detach into two separate, field-equal copies. The values never change,
        // so a toggle produces a topology difference and nothing else.
        const selectPair = (data: TReadonly<IShareData>): {left: {v: number}; right: {v: number}} => ({
            left: data.left,
            right: data.share ? data.left : data.right,
        });

        test('a shared pair becoming two equal copies re-renders the memo child (R5-01)', () => {
            const store = new ShareCarburetor({share: true, left: {v: 1}, right: {v: 1}});
            let memoRenders = 0;

            const MemoPair = React.memo(({pair}: {pair: {left: {v: number}; right: {v: number}}}) => {
                memoRenders++;

                return <span className="memo-pair">{pair.left === pair.right ? 'shared' : 'separate'}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly pair = this.connectSelection(() => store, selectPair);

                render() {
                    return <MemoPair pair={this.pair()} />;
                }
            }

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const {container, unmount} = render(<Parent />);

                expect(container.querySelector('.memo-pair')?.textContent).toEqual('shared');
                expect(memoRenders).toEqual(1);

                // Both objects still hold v: 1, so only a comparison that tracks which previous
                // objects are shared can see this toggle as a change.
                act(() => store.setShare(false));

                expect(memoRenders).toEqual(2);
                expect(container.querySelector('.memo-pair')?.textContent).toEqual('separate');

                unmount();
            } finally {
                console.error = original;
            }

            // Selecting branches is the review's repro shape on purpose: detachment keeps the
            // child safe, and the escape is still reported once per selection.
            expect(reported.filter((message) => message.includes('connectSelection()')).length).toEqual(1);
        });

        test('two equal copies becoming a shared pair re-renders the memo child (R5-01)', () => {
            const store = new ShareCarburetor({share: false, left: {v: 1}, right: {v: 1}});
            let memoRenders = 0;

            const MemoPair = React.memo(({pair}: {pair: {left: {v: number}; right: {v: number}}}) => {
                memoRenders++;

                return <span className="memo-pair">{pair.left === pair.right ? 'shared' : 'separate'}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly pair = this.connectSelection(() => store, selectPair);

                render() {
                    return <MemoPair pair={this.pair()} />;
                }
            }

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                const {container, unmount} = render(<Parent />);

                expect(container.querySelector('.memo-pair')?.textContent).toEqual('separate');
                expect(memoRenders).toEqual(1);

                act(() => store.setShare(true));

                expect(memoRenders).toEqual(2);
                expect(container.querySelector('.memo-pair')?.textContent).toEqual('shared');

                unmount();
            } finally {
                console.error = original;
            }

            // Selecting branches is the review's repro shape on purpose: detachment keeps the
            // child safe, and the escape is still reported once per selection.
            expect(reported.filter((message) => message.includes('connectSelection()')).length).toEqual(1);
        });

        test('a null-prototype dictionary and an ordinary object with the same fields are a change (R5-01)', () => {
            interface IProtoData {
                asDictionary: boolean;
                value: number;
            }

            class ProtoCarburetor extends Carburetor<IProtoData> {
                public setAsDictionary = (asDictionary: boolean): void => {
                    this.update((draft: IProtoData): void => {
                        draft.asDictionary = asDictionary;
                    });
                };
            }

            const store = new ProtoCarburetor({asDictionary: true, value: 1});
            let memoRenders = 0;

            const MemoProto = React.memo(({item}: {item: {v: number}}) => {
                memoRenders++;

                return (
                    <span className="memo-proto">
                        {Object.getPrototypeOf(item) === null ? 'dictionary' : 'ordinary'}:{item.v}
                    </span>
                );
            });

            class Parent extends AntiHookComponent {
                private readonly selected = this.connectSelection(
                    () => store,
                    (data: TReadonly<IProtoData>) => ({
                        item: data.asDictionary
                            ? Object.assign(Object.create(null), {v: data.value})
                            : {v: data.value}
                    })
                );

                render() {
                    return <MemoProto item={this.selected().item} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-proto')?.textContent).toEqual('dictionary:1');
            expect(memoRenders).toEqual(1);

            act(() => store.setAsDictionary(false));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-proto')?.textContent).toEqual('ordinary:1');

            unmount();
        });

        test('an in-place Map mutation re-renders the memo child with the new content (R5-02)', () => {
            interface IMapData {
                map: Map<string, number>;
            }

            class MapCarburetor extends Carburetor<IMapData> {
                public setEntry = (key: string, value: number): void => {
                    this.update((draft: IMapData): void => {
                        // The rule is right; the in-place Map mutation is the exact shape this R5-02 test pins down.
                        // oxlint-disable-next-line carburetor/no-untrackable-draft-mutation
                        draft.map.set(key, value);
                    });
                };
            }

            const store = new MapCarburetor({map: new Map<string, number>([['a', 1]])});
            let parentRenders = 0;
            let memoRenders = 0;

            const MemoMap = React.memo(({model}: {model: {map: Map<string, number>}}) => {
                memoRenders++;

                return <span className="memo-map">{model.map.get('a')}</span>;
            });

            class Parent extends AntiHookComponent {
                private readonly selected = this.connectSelection(
                    () => store,
                    (data: TReadonly<IMapData>) => ({map: data.map})
                );

                render() {
                    parentRenders++;

                    return <MemoMap model={this.selected()} />;
                }
            }

            const {container, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-map')?.textContent).toEqual('1');
            expect(memoRenders).toEqual(1);

            // Handing out the untrackable leaf records the `map` path, so the owner wakes; the
            // snapshot must not be reused on the strength of `Object.is(oldMap, newMap)` alone.
            act(() => store.setEntry('a', 2));

            expect(parentRenders).toBeGreaterThanOrEqual(2);
            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-map')?.textContent).toEqual('2');
            expect(store.getData().map.get('a')).toEqual(2);

            unmount();
        });

        test('a selection holding an exotic member is treated as changed on every owner render (R5-02)', () => {
            interface IMapData {
                // The rule is right; the exotic Map in store data is the subject of this R5-02 test.
                // oxlint-disable-next-line carburetor/no-untrackable-store-data
                map: Map<string, number>;
            }

            class MapCarburetor extends Carburetor<IMapData> {
                public setEntry = (key: string, value: number): void => {
                    this.update((draft: IMapData): void => {
                        // The rule is right; the in-place Map mutation is the exact shape this R5-02 test pins down.
                        // oxlint-disable-next-line carburetor/no-untrackable-draft-mutation
                        draft.map.set(key, value);
                    });
                };
            }

            const store = new MapCarburetor({map: new Map<string, number>([['a', 1]])});
            let memoRenders = 0;

            const MemoMap = React.memo(({model}: {model: {map: Map<string, number>}}) => {
                memoRenders++;

                return <span className="memo-map">{model.map.get('a')}</span>;
            });

            class Parent extends AntiHookComponent<{flag?: string}> {
                private readonly selected = this.connectSelection(
                    () => store,
                    (data: TReadonly<IMapData>) => ({map: data.map})
                );

                render() {
                    return <MemoMap model={this.selected()} />;
                }
            }

            const {container, rerender, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-map')?.textContent).toEqual('1');
            expect(memoRenders).toEqual(1);

            // The documented tradeoff: with a mutable member in play the comparison cannot
            // prove "unchanged", so the child re-renders with the owner even though no store
            // write happened. Projecting the Map into plain data restores precision.
            rerender(<Parent flag="second" />);

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-map')?.textContent).toEqual('1');

            unmount();
        });
    });
