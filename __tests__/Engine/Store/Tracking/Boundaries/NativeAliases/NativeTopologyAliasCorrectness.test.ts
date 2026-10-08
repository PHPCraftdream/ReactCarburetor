/* oxlint-disable carburetor/no-untrackable-store-data */
import {Carburetor} from "@/Carburetor";
import {nativeAliasIndex} from '@/Carburetor/Store/Tracking/Aliases/NativeAliasIndex';

class ScalarPayload {
    public readonly ms = 1;
}

class DayStamp {
    public readonly $d = new Date(1);
    public constructor(public readonly $x: IRow) {}
}

interface IRow {
    n: number;
}

interface IState {
    other: IRow;
    rows: IRow[];
    alias?: IRow;
    map: Map<unknown, unknown>;
}

interface INestedAliasState {
    other: IRow;
    branch: {nested: IRow};
    map: Map<string, IRow>;
}

class TopologyAliasStore extends Carburetor<IState> {
    public change(mutate: (draft: IState) => void): void {
        this.update(mutate);
    }
}

/** A detached member starts with no ordinary ownership path. */
const makeStore = (): {store: TopologyAliasStore; member: IRow} => {
    const member = {n: 1};
    return {
        store: new TopologyAliasStore({other: {n: 0}, rows: [], map: new Map([['member', member]])}),
        member,
    };
};

describe('R39-03 native alias correctness across topology', () => {
    test.each(['Date', 'flat instance'])('%s: in-place object addition refreshes a scalar negative answer only after topology', kind => {
        const {store} = makeStore();
        const root = store.getData();
        const native = kind === 'Date' ? new Date(1) : new ScalarPayload();
        root.map.set('native', native);
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        const read = (): void => {
            reads.clear();
            expect(view.map.get('native')).toBe(native);
        };
        read();
        expect(reads.has('other')).toBe(false);
        // Include non-enumerable symbol data; a permanent negative cache would miss it.
        Object.defineProperty(native, Symbol('added'), {value: root.other});
        read();
        expect(reads.has('other')).toBe(false);
        store.change(draft => { draft.rows = [{n: 5}]; });
        read();
        expect(reads.has('other')).toBe(true);
        let wakes = 0;
        const id = store.subscribe(() => { wakes++; }, {reads});
        try {
            store.change(draft => { draft.other.n++; });
            expect(wakes).toBe(1);
        } finally {
            store.unsubscribe(id);
        }
    });

    test('embellished Date preserves non-enumerable string and symbol object aliases without invoking getters', () => {
        const {store} = makeStore();
        const root = store.getData();
        const native = new Date(1);
        let getters = 0;
        Object.defineProperty(native, 'payload', {value: root.other});
        Object.defineProperty(native, Symbol('payload'), {value: root.rows});
        Object.defineProperty(native, 'accessor', {get: () => { getters++; return root; }});
        root.map.set('native', native);
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        const read = (): void => {
            reads.clear();
            expect(view.map.get('native')).toBe(native);
        };
        read();
        expect(reads.has('other')).toBe(true);
        expect(reads.has('rows')).toBe(true);
        expect(reads.has('*')).toBe(false);
        read();
        expect(reads.has('other')).toBe(true);
        expect(reads.has('rows')).toBe(true);
        expect(getters).toBe(0);
    });

    test('a Map member wakes on its ordinary write, not on a sibling write', () => {
        const {store, member} = makeStore();
        store.change(draft => { draft.alias = member; });
        const changes: number[] = [];
        const stop = store.watch(view => (view.map.get('member') as IRow).n,
            n => { changes.push(n); });
        try {
            store.change(draft => { draft.other.n++; });
            expect(changes).toEqual([]);
            store.change(draft => { draft.alias!.n = 2; });
            expect(changes).toEqual([2]);
        } finally {
            stop();
        }
    });

    test('a native root backlink records whole-store dependence and wakes on a sibling', () => {
        const {store} = makeStore();
        const root = store.getData();
        root.map.set('root', root);
        const reads = new Set<string>();
        expect(store.read(path => reads.add(path)).map.get('root')).toBe(root);
        expect(reads.has('*')).toBe(true);
        let wakes = 0;
        const id = store.subscribe(() => { wakes++; }, {reads});
        try {
            store.change(draft => { draft.other.n++; });
            expect(wakes).toBe(1);
        } finally {
            store.unsubscribe(id);
        }
    });

    test('an ordinary Map key records its path and wakes on its ordinary write', () => {
        const key = {n: 1};
        const store = new TopologyAliasStore({
            other: {n: 0}, alias: key, rows: [], map: new Map([[key, 'value']]),
        });
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        expect([...view.map.keys()][0]).toBe(key);
        expect(reads.has('alias')).toBe(true);
        const changes: number[] = [];
        const stop = store.watch(data => ([...data.map.keys()][0] as IRow).n,
            n => { changes.push(n); });
        try {
            store.change(draft => { draft.other.n++; });
            expect(changes).toEqual([]);
            store.change(draft => { draft.alias!.n = 3; });
            expect(changes).toEqual([3]);
        } finally {
            stop();
        }
    });

    test('a cached negative answer finds a newly added alias even before publication', () => {
        const {store, member} = makeStore();
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        expect(view.map.get('member')).toBe(member);
        expect(reads.has('alias')).toBe(false);
        store.change(draft => {
            draft.alias = member;
            reads.clear();
            expect(view.map.get('member')).toBe(member);
            expect(reads.has('alias')).toBe(true);
        });
        const changes: number[] = [];
        const stop = store.watch(data => (data.map.get('member') as IRow).n,
            n => { changes.push(n); });
        try {
            store.change(draft => { draft.alias!.n = 4; });
            expect(changes).toEqual([4]);
        } finally {
            stop();
        }
    });

    test('nested draft replacement refreshes its raw Map alias before publication and wakes', () => {
        const environment = process.env.NODE_ENV;
        const noteChange = nativeAliasIndex.noteChange;
        let dispose: (() => void) | undefined;
        try {
            // Disable the development ledger's eager normalization: exercise the public
            // same-kind set path that defers nested view normalization to diffPaths.
            process.env.NODE_ENV = 'production';
            class NestedAliasStore extends Carburetor<INestedAliasState> {
                public replace(): void {
                    this.update(draft => {
                        const proxy = draft.other;
                        draft.branch = {nested: proxy};
                        normalized = this.getData().branch.nested === member;
                        reads.clear();
                        sameMember = view.map.get('member') === member;
                        beforePublication = reads.has('branch.nested');
                    });
                }
                public edit(): void {
                    this.update(draft => { draft.branch.nested.n++; });
                }
            }
            const member = {n: 1};
            const nestedStore = new NestedAliasStore({
                other: member, branch: {nested: {n: 0}}, map: new Map([['member', member]]),
            });
            const root = nestedStore.getData();
            const reads = new Set<string>();
            const view = nestedStore.read(path => reads.add(path));
            expect(view.map.get('member')).toBe(member);
            expect(reads.has('other')).toBe(true);
            expect(reads.has('branch.nested')).toBe(false);
            const warmed = nativeAliasIndex.paths(root);
            let pendingProxy = false;
            let indexedProxy = false;
            let sawHook = false;
            let normalized = false;
            let sameMember = false;
            let beforePublication = false;
            nativeAliasIndex.noteChange = (...args): void => {
                noteChange(...args);
                if (args[0] === root && args[2] === 'branch') {
                    // Observe the informative set hook BEFORE diffPaths runs. Do not
                    // rebuild here: inspect the warmed map that local repair can poison.
                    const nested = (args[4] as {nested: IRow}).nested;
                    sawHook = true;
                    pendingProxy = nested !== member;
                    indexedProxy = warmed.has(nested);
                }
            };
            nestedStore.replace();
            nativeAliasIndex.noteChange = noteChange;
            let wakes = 0;
            const id = nestedStore.subscribe(() => { wakes++; }, {reads});
            dispose = () => nestedStore.unsubscribe(id);
            nestedStore.edit();
            expect(sawHook).toBe(true);
            expect(pendingProxy).toBe(true);
            expect(normalized).toBe(true);
            expect(sameMember).toBe(true);
            expect(indexedProxy).toBe(false);
            expect(beforePublication).toBe(true);
            expect(wakes).toBe(1);
        } finally {
            nativeAliasIndex.noteChange = noteChange;
            dispose?.();
            process.env.NODE_ENV = environment;
        }
    });

    test('deleting an alias removes its cached path before the next native read', () => {
        const {store, member} = makeStore();
        store.change(draft => { draft.alias = member; });
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        view.map.get('member');
        expect(reads.has('alias')).toBe(true);
        store.change(draft => {
            delete draft.alias;
            reads.clear();
            expect(view.map.get('member')).toBe(member);
            expect(reads.has('alias')).toBe(false);
        });
        let wakes = 0;
        const id = store.subscribe(() => { wakes++; }, {reads});
        try {
            store.change(draft => { draft.alias = {n: 9}; });
            expect(wakes).toBe(0);
        } finally {
            store.unsubscribe(id);
        }
    });

    test('splice refreshes shifted and removed paths on the same persistent view', () => {
        const {store, member} = makeStore();
        store.change(draft => { draft.rows = [{n: 0}, member]; });
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        view.map.get('member');
        expect(reads.has('rows.1')).toBe(true);
        store.change(draft => {
            draft.rows.splice(0, 1);
            reads.clear();
            expect(view.map.get('member')).toBe(member);
            expect(reads.has('rows.0')).toBe(true);
            expect(reads.has('rows.1')).toBe(false);
            draft.rows.splice(0, 1);
            reads.clear();
            expect(view.map.get('member')).toBe(member);
            expect(reads.has('rows.0')).toBe(false);
            expect(reads.has('rows.1')).toBe(false);
        });
    });

    test('dayjs-like object aliases refresh before publication and subscribe after add/delete', () => {
        const {store, member} = makeStore();
        const stamp = new DayStamp(member);
        store.getData().map.set('stamp', stamp);
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        const read = (): void => {
            reads.clear();
            expect(view.map.get('stamp')).toBe(stamp);
        };
        read();
        expect(reads.has('alias')).toBe(false);
        store.change(draft => {
            draft.alias = member;
            read();
            expect(reads.has('alias')).toBe(true);
        });
        const changes: number[] = [];
        const stop = store.watch(data => (data.map.get('stamp') as DayStamp).$x.n,
            n => { changes.push(n); });
        try {
            store.change(draft => { draft.other.n++; });
            expect(changes).toEqual([]);
            store.change(draft => { draft.alias!.n = 6; });
            expect(changes).toEqual([6]);
            store.change(draft => {
                delete draft.alias;
                read();
                expect(reads.has('alias')).toBe(false);
            });
        } finally {
            stop();
        }
        let wakes = 0;
        const id = store.subscribe(() => { wakes++; }, {reads});
        try {
            store.change(draft => { draft.alias = {n: 9}; });
            expect(wakes).toBe(0);
        } finally {
            store.unsubscribe(id);
        }
    });

    // Public regression: length truncation must refresh aliases before publication.
    // Keep this assertion active to cover write-proxy integration, not just unit fallback.
    test('length truncation removes cached ordinary aliases before the next public native read', () => {
        const {store, member} = makeStore();
        store.change(draft => { draft.rows = [member]; });
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        view.map.get('member');
        expect(reads.has('rows.0')).toBe(true);
        store.change(draft => {
            draft.rows.length = 0;
            reads.clear();
            expect(view.map.get('member')).toBe(member);
            expect(reads.has('rows.0')).toBe(false);
        });
        let wakes = 0;
        const id = store.subscribe(() => { wakes++; }, {reads});
        try {
            store.change(draft => { draft.rows.push({n: 9}); });
            expect(wakes).toBe(0);
        } finally {
            store.unsubscribe(id);
        }
    });

    test.each(['set', 'define'])('%s: partial length failure refreshes ownership and aliases', kind => {
        const {store, member} = makeStore();
        store.change(draft => { draft.rows = [{n: 0}, member]; });
        const root = store.getData();
        Object.defineProperty(root.rows, '0', {configurable: false});
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        expect(view.map.get('member')).toBe(member);
        expect(reads.has('rows.1')).toBe(true);
        const built = nativeAliasIndex.paths(root);
        const generation = nativeAliasIndex.generation(root);
        store.change(draft => {
            const wrote = kind === 'set'
                ? Reflect.set(draft.rows, 'length', 0)
                : Reflect.defineProperty(draft.rows, 'length', {value: 0});
            expect(wrote).toBe(false);
            expect(draft.rows.length).toBe(1);
            expect(nativeAliasIndex.generation(root)).toBe(generation + 1);
            expect(nativeAliasIndex.paths(root)).not.toBe(built);
            expect(nativeAliasIndex.paths(root).has(member)).toBe(false);
            reads.clear();
            expect(view.map.get('member')).toBe(member);
            expect(reads.has('rows.1')).toBe(false);
        });
    });

    test('length growth and no-op preserve the built ownership map and generation', () => {
        const {store, member} = makeStore();
        store.change(draft => { draft.rows = [member]; });
        const root = store.getData();
        const built = nativeAliasIndex.paths(root);
        const generation = nativeAliasIndex.generation(root);
        store.change(draft => {
            expect(Reflect.set(draft.rows, 'length', 1)).toBe(true);
            expect(Reflect.set(draft.rows, 'length', 3)).toBe(true);
            expect(Reflect.defineProperty(draft.rows, 'length', {value: 3})).toBe(true);
            expect(Reflect.defineProperty(draft.rows, 'length', {value: 5})).toBe(true);
            expect(nativeAliasIndex.generation(root)).toBe(generation);
            expect(nativeAliasIndex.paths(root)).toBe(built);
            expect(built.get(member)).toEqual(['rows.0']);
        });
    });

    test('setData and restore discard old paths for the same native member', () => {
        const {store, member} = makeStore();
        store.change(draft => { draft.alias = member; });
        const capture = (expected: IRow = member): Set<string> => {
            const reads = new Set<string>();
            expect(store.read(path => reads.add(path)).map.get('member')).toBe(expected);
            return reads;
        };
        expect(capture().has('alias')).toBe(true);
        const third = {n: 0};
        store.setData({other: member, alias: third, rows: [], map: new Map([['member', member]])});
        const installed = capture();
        expect(installed.has('other')).toBe(true);
        expect(installed.has('alias')).toBe(false);
        store.restore({other: member, alias: third, rows: [], map: new Map([['member', third]])});
        const restored = capture(third);
        expect(restored.has('alias')).toBe(true);
        expect(restored.has('other')).toBe(false);
        const changes: number[] = [];
        const stop = store.watch(data => (data.map.get('member') as IRow).n,
            n => { changes.push(n); });
        try {
            store.change(draft => { draft.alias!.n = 5; });
            expect(changes).toEqual([5]);
        } finally {
            stop();
        }
    });
});
