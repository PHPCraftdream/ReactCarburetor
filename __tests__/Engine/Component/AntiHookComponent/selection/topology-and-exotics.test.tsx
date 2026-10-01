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

            const {container, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-pair')?.textContent).toEqual('shared');
            expect(memoRenders).toEqual(1);

            // Both objects hold v: 1; the graph's sharing is what changed.
            act(() => store.setShare(false));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-pair')?.textContent).toEqual('separate');
            unmount();
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

            const {container, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-pair')?.textContent).toEqual('separate');
            expect(memoRenders).toEqual(1);

            act(() => store.setShare(true));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-pair')?.textContent).toEqual('shared');
            unmount();
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

        test('an unchanged Date in the selection keeps the memo child bail-out (R30-03)', () => {
            const at = new Date(1000);
            const store = new Carburetor<{at: Date; other: number}>({at, other: 0});
            let memoRenders = 0;

            const MemoWhen = React.memo(({model}: {model: {at: Date}}) => {
                memoRenders++;

                return <span className="memo-when">{model.at.getTime()}</span>;
            });

            class Parent extends AntiHookComponent<{flag?: string}> {
                private readonly selected = this.connectSelection(
                    () => store,
                    (data: TReadonly<{at: Date; other: number}>) => ({at: data.at})
                );

                render() {
                    return <MemoWhen model={this.selected()} />;
                }
            }

            const {container, rerender, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-when')?.textContent).toEqual('1000');
            expect(memoRenders).toEqual(1);

            // An owner re-render with no content change: the detached Date compares equal to
            // the live one, so the snapshot keeps its identity and the child bails out.
            rerender(<Parent flag="second" />);
            expect(memoRenders).toEqual(1);

            // An in-place setTime is a content change on the next comparison.
            at.setTime(2000);
            rerender(<Parent flag="third" />);
            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-when')?.textContent).toEqual('2000');

            unmount();
        });

        test('a class instance in the selection is always a change for the memo child (R30-03)', () => {
            class Box {
                public constructor(public v: number) {}
            }

            const store = new Carburetor<{box: Box}>({box: new Box(1)});
            let memoRenders = 0;

            const MemoBox = React.memo(({model}: {model: {box: Box}}) => {
                memoRenders++;

                return <span className="memo-box">{model.box.v}</span>;
            });

            class Parent extends AntiHookComponent<{flag?: string}> {
                private readonly selected = this.connectSelection(
                    () => store,
                    (data) => ({box: data.box})
                );

                render() {
                    return <MemoBox model={this.selected()} />;
                }
            }

            const {container, rerender, unmount} = render(<Parent />);

            expect(container.querySelector('.memo-box')?.textContent).toEqual('1');
            expect(memoRenders).toEqual(1);

            // A live class instance cannot be proven unchanged, so the child re-renders with
            // the owner even though no store write happened.
            rerender(<Parent flag="second" />);
            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-box')?.textContent).toEqual('1');

            unmount();
        });

        test('an unchanged Map keeps the memo child bail-out; a Map.set re-renders it (R30-03)', () => {
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

            // R30-03: the detached copy compares by content, so an unchanged Map lets the
            // snapshot keep its identity and the memo child keeps its bail-out.
            rerender(<Parent flag="second" />);

            expect(memoRenders).toEqual(1);
            expect(container.querySelector('.memo-map')?.textContent).toEqual('1');

            // An in-place Map.set is a content change: the child re-renders with the new value.
            act(() => store.setEntry('a', 2));

            expect(memoRenders).toEqual(2);
            expect(container.querySelector('.memo-map')?.textContent).toEqual('2');

            unmount();
        });
    });

type TNativeRoot = Map<unknown, unknown> | Set<unknown> | Date;

/** Makes a native root whose intrinsic contents point back to it (R30-04: own fields are not copied). */
const nativeRoot = (kind: 'Map' | 'Set' | 'Date', n: number): TNativeRoot => {
    let root: TNativeRoot;

    if (kind === 'Map') {
        const map = new Map<unknown, unknown>([['id', n]]);
        map.set(map, 'self');
        root = map;
    } else if (kind === 'Set') {
        const set = new Set<unknown>([n]);
        set.add(set);
        root = set;
    } else {
        root = new Date(n * 100);
    }

    return root;
};

/** Reads a native snapshot through its actual brand-checked methods. */
const nativeAmount = (value: TReadonly<TNativeRoot>): number => {
    if (value instanceof Map) {
        return Number(value.get('id'));
    }
    if (value instanceof Set) {
        return Number(value.values().next().value);
    }
    return value.getTime();
};

describe('connectSelection over an opaque native root', () => {
    test.each(['Map', 'Set', 'Date'] as const)('%s root follows replacements and source swaps', async kind => {
        const firstStore = new Carburetor(nativeRoot(kind, 1));
        const otherStore = new Carburetor(nativeRoot(kind, 3));
        const snapshots: Array<TReadonly<TNativeRoot>> = [];
        const unit = kind === 'Date' ? 100 : 1;

        class Parent extends AntiHookComponent<{store: Carburetor<TNativeRoot>}> {
            private readonly live = this.connect(() => this.props.store);
            private readonly selected = this.connectSelection(() => this.props.store, () => this.live);

            render() {
                const selected = this.selected();
                snapshots.push(selected);
                return <span className="native-root">{nativeAmount(selected)}</span>;
            }
        }

        const view = render(<Parent store={firstStore} />);
        expect(view.container.querySelector('.native-root')?.textContent).toBe(`${unit}`);
        const initial = snapshots[0];
        expect(initial).not.toBe(firstStore.getData());

        if (initial instanceof Map) {
            expect(initial.get(initial)).toBe('self');
            initial.set('id', 99);
        } else if (initial instanceof Set) {
            expect(initial.has(initial)).toBe(true);
            initial.add(99);
        } else {
            initial.setTime(999);
        }
        expect(nativeAmount(firstStore.getData())).toBe(unit);

        if (initial instanceof Map) {
            expect(initial.get(initial)).toBe('self');
            initial.set('id', 99);
        } else if (initial instanceof Set) {
            expect(initial.has(initial)).toBe(true);
            initial.add(99);
        } else {
            initial.setTime(999);
        }
        expect(nativeAmount(firstStore.getData())).toBe(unit);

        // An equal owner re-render must re-record the native root wildcard for the
        // following write, even when the persistent connection cached its raw root.
        view.rerender(<Parent store={firstStore} />);

        await act(async () => { firstStore.setData(nativeRoot(kind, 2)); });
        expect(view.container.querySelector('.native-root')?.textContent).toBe(`${unit * 2}`);
        expect(snapshots[snapshots.length - 1]).not.toBe(initial);

        view.rerender(<Parent store={otherStore} />);
        expect(view.container.querySelector('.native-root')?.textContent).toBe(`${unit * 3}`);
        await act(async () => { firstStore.setData(nativeRoot(kind, 4)); });
        expect(view.container.querySelector('.native-root')?.textContent).toBe(`${unit * 3}`);
        await act(async () => { otherStore.setData(nativeRoot(kind, 5)); });
        expect(view.container.querySelector('.native-root')?.textContent).toBe(`${unit * 5}`);
        view.unmount();
    });
});

type TObjectAliasRoot = {id: number; index: Map<object, string>; members: Set<object>};
type TArrayAliasRoot = [Map<object, string>, Set<object>, number];
type TAliasRoot = TObjectAliasRoot | TArrayAliasRoot;
type TAliasRootKind = 'object' | 'null' | 'array' | 'objectArray' | 'nullArray';

/** Creates a valid state root referenced from opaque Map keys and Set members. */
const aliasRoot = (kind: TAliasRootKind, id: number, answer = `answer${id}`): TAliasRoot => {
    const array = kind === 'array' || kind === 'objectArray' || kind === 'nullArray';
    const root = (array ? [] : Object.create(kind === 'null' ? null : Object.prototype)) as TAliasRoot;
    if (kind === 'objectArray' || kind === 'nullArray') {
        Object.setPrototypeOf(root, kind === 'nullArray' ? null : Object.prototype);
    }
    Object.defineProperty(root, array ? '0' : 'index', {
        value: new Map<object, string>([[root, answer]]),
        enumerable: true, writable: true, configurable: false
    });
    Object.defineProperty(root, array ? '1' : 'members', {
        value: new Set<object>([root]),
        enumerable: true, writable: true, configurable: false
    });
    Object.defineProperty(root, array ? '2' : 'id', {
        value: id, enumerable: true, writable: true, configurable: false
    });
    return root;
};

/** Reads either supported root shape without requiring Array methods on its prototype. */
const aliasFields = (root: TReadonly<TAliasRoot>): {
    id: number; index: TReadonly<Map<object, string>>; members: TReadonly<Set<object>>;
} => {
    if (Array.isArray(root)) {
        const value = root as unknown as readonly [Map<object, string>, Set<object>, number];
        return {index: value[0], members: value[1], id: value[2]};
    }
    return root as TReadonly<TObjectAliasRoot>;
};

/** Read only the id, not the array's Map/Set slots. */
const aliasId = (root: TReadonly<TAliasRoot>): number =>
    Array.isArray(root)
        ? (root as unknown as readonly [unknown, unknown, number])[2]
        : (root as TReadonly<TObjectAliasRoot>).id;

describe('connectSelection over a supported root facade', () => {
    test.each([
        ['object', 'rawFirst'], ['object', 'proxyFirst'],
        ['null', 'rawFirst'], ['null', 'proxyFirst'],
        ['array', 'rawFirst'], ['array', 'proxyFirst'],
        ['objectArray', 'rawFirst'], ['objectArray', 'proxyFirst'],
        ['nullArray', 'rawFirst'], ['nullArray', 'proxyFirst']
    ] as const)('%s root preserves %s Map/Set aliases and precise subscriptions', async (kind, order) => {
        const firstStore = new Carburetor<TAliasRoot>(aliasRoot(kind, 1));
        const otherStore = new Carburetor<TAliasRoot>(aliasRoot(kind, 3));
        const snapshots: Array<{
            root: TReadonly<TAliasRoot>;
            index: TReadonly<Map<object, string>>;
            members: TReadonly<Set<object>>
        }> = [];
        let narrowRenders = 0;

        class Parent extends AntiHookComponent<{store: Carburetor<TAliasRoot>}> {
            private readonly live = this.connect(() => this.props.store);
            private readonly selected = this.connectSelection(() => this.props.store, () => {
                const {index, members} = aliasFields(this.live);
                return order === 'rawFirst'
                    ? {index, members, root: this.live}
                    : {root: this.live, index, members};
            });

            render() {
                const selected = this.selected();
                snapshots.push(selected);
                return <span className="alias-root">
                    {aliasFields(selected.root).id}:{selected.index.get(selected.root)}:
                    {selected.members.has(selected.root) ? 'member' : 'missing'}
                </span>;
            }
        }

        class Narrow extends AntiHookComponent<{store: Carburetor<TAliasRoot>}> {
            private readonly live = this.connect(() => this.props.store);
            private readonly selected = this.connectSelection(
                () => this.props.store, () => ({id: aliasId(this.live)})
            );

            render() {
                narrowRenders++;
                return <span className="narrow-root">{this.selected().id}</span>;
            }
        }

        const view = render(<><Parent store={firstStore} /><Narrow store={firstStore} /></>);
        const text = (): string | undefined => view.container.querySelector('.alias-root')?.textContent?.replace(/\s/g, '');
        expect(text()).toBe('1:answer1:member');
        const initial = snapshots[0];
        expect(initial.root).not.toBe(firstStore.getData());
        expect(aliasFields(initial.root).index).toBe(initial.index);
        expect(aliasFields(initial.root).members).toBe(initial.members);
        expect(Array.isArray(initial.root)).toBe(kind.includes('Array') || kind === 'array');
        expect(Object.getPrototypeOf(initial.root)).toBe(
            kind === 'null' || kind === 'nullArray' ? null
                : kind === 'objectArray' ? Object.prototype
                    : kind === 'array' ? Array.prototype : Object.prototype
        );
        // R30-04: descriptor flags are not part of a selection — the detached copy carries
        // plain writable/configurable fields, but keeps the enumerable string-key set.
        expect(Object.getOwnPropertyDescriptor(initial.root, Array.isArray(initial.root) ? '2' : 'id'))
            .toMatchObject({enumerable: true, writable: true, configurable: true});
        expect(Object.getOwnPropertyDescriptor(initial.root, Array.isArray(initial.root) ? '0' : 'index')?.enumerable)
            .toBe(true);

        initial.index.set(initial.root, 'consumer edit');
        initial.members.delete(initial.root);
        expect(aliasFields(firstStore.getData()).index.get(firstStore.getData())).toBe('answer1');
        expect(aliasFields(firstStore.getData()).members.has(firstStore.getData())).toBe(true);

        await act(async () => { firstStore.setData(aliasRoot(kind, 2)); });
        expect(text()).toBe('2:answer2:member');
        expect(snapshots[snapshots.length - 1].root).not.toBe(initial.root);

        const beforeNarrowOnly = narrowRenders;
        await act(async () => { firstStore.setData(aliasRoot(kind, 2, 'changed')); });
        expect(text()).toBe('2:changed:member');
        expect(narrowRenders).toBe(beforeNarrowOnly);

        view.rerender(<><Parent store={otherStore} /><Narrow store={otherStore} /></>);
        expect(text()).toBe('3:answer3:member');
        const beforeOldSource = narrowRenders;
        await act(async () => { firstStore.setData(aliasRoot(kind, 4)); });
        expect(text()).toBe('3:answer3:member');
        expect(narrowRenders).toBe(beforeOldSource);
        await act(async () => { otherStore.setData(aliasRoot(kind, 5)); });
        expect(text()).toBe('5:answer5:member');
        expect(view.container.querySelector('.narrow-root')?.textContent).toBe('5');
        view.unmount();
    });
});
