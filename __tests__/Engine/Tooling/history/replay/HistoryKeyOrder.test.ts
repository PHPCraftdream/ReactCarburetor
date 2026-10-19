import {Carburetor, CarburetorHistory, ComponentUpdateThrottle, transaction} from '@/Carburetor';

class OrderedStore extends Carburetor<{first?: number; middle?: number; last: number; marker: number}> {
    public remove(key: 'first' | 'middle'): void {
        this.update(draft => { delete draft[key]; });
    }
    public move(key: 'first' | 'middle'): void {
        this.update(draft => {
            const value = draft[key];
            delete draft[key];
            draft[key] = value;
        });
    }
    public mark(value: number): void {
        this.update(draft => { draft.marker = value; });
    }
}

class ManualThrottle extends ComponentUpdateThrottle {
    protected setupTimeout(): void {}
    public flush(): void { this.letsUpdate(); }
}

const makeStore = (throttle?: ManualThrottle): OrderedStore =>
    new OrderedStore({first: 1, middle: 2, last: 3, marker: 0}, throttle);

const keys = (store: OrderedStore): string[] => Object.keys(store.getData());

const before = ['first', 'middle', 'last', 'marker'];

describe('ordered own keys in history endpoints', () => {
    test.each(['first', 'middle'] as const)('root %s deletion restores its original position', key => {
        const store = makeStore();
        const history = new CarburetorHistory(store);
        store.remove(key);
        const after = before.filter(field => field !== key);
        expect(keys(store)).toEqual(after);
        for (let i = 0; i < 2; i++) {
            expect(history.undo()).toBe(true);
            expect(keys(store)).toEqual(before);
            expect(history.redo()).toBe(true);
            expect(keys(store)).toEqual(after);
        }
        history.disconnect();
    });

    test('delete/reinsert moves a key even though membership and values are unchanged', () => {
        const store = makeStore();
        const history = new CarburetorHistory(store);
        store.move('first');
        const moved = ['middle', 'last', 'marker', 'first'];
        expect(keys(store)).toEqual(moved);
        expect(history.undo()).toBe(true);
        expect(keys(store)).toEqual(before);
        expect(history.redo()).toBe(true);
        expect(keys(store)).toEqual(moved);
        history.disconnect();
    });

    test('setData and nested deletion preserve null prototype, numeric order and escaped names', () => {
        const initial = Object.assign(Object.create(null) as Record<string, number>, {
            '9': 9, '2': 2, 'a.b': 1, 'back\\slash': 2, tail: 3,
        });
        class Nested extends Carburetor<{row: Record<string, number>; marker: number}> {
            public remove(): void { this.update(draft => { delete draft.row['a.b']; }); }
        }
        const store = new Nested({row: initial, marker: 0});
        const history = new CarburetorHistory(store);
        const original = ['2', '9', 'a.b', 'back\\slash', 'tail'];
        store.remove();
        expect(Object.keys(store.getData().row)).toEqual(['2', '9', 'back\\slash', 'tail']);
        expect(history.undo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData().row)).toBe(null);
        expect(Object.keys(store.getData().row)).toEqual(original);
        expect(history.redo()).toBe(true);
        expect(Object.keys(store.getData().row)).toEqual(['2', '9', 'back\\slash', 'tail']);
        store.setData({row: Object.assign(Object.create(null), {
            '9': 9, '2': 2, 'back\\slash': 2, tail: 3, 'a.b': 1,
        }) as Record<string, number>, marker: 0});
        expect(Object.keys(store.getData().row)).toEqual(['2', '9', 'back\\slash', 'tail', 'a.b']);
        expect(history.undo()).toBe(true);
        expect(Object.keys(store.getData().row)).toEqual(['2', '9', 'back\\slash', 'tail']);
        expect(history.undo()).toBe(true);
        expect(Object.keys(store.getData().row)).toEqual(original);
        history.disconnect();
    });

    test('ordered replay retains native aliases, hidden descriptors and locked array length', () => {
        const row = {id: 1};
        const items = [4, 5];
        Object.defineProperty(items, 'length', {writable: false});
        type State = {first?: number; middle: number; last: number; row: typeof row;
            map: Map<object, object>; items: number[]};
        const state: State = {first: 1, middle: 2, last: 3, row, map: new Map([[row, row]]), items};
        Object.defineProperty(state.map, 'owner', {
            value: state, writable: false, enumerable: false, configurable: true,
        });
        class NativeOrdered extends Carburetor<State> {
            public remove(): void { this.update(draft => { delete draft.first; }); }
        }
        const store = new NativeOrdered(state);
        const history = new CarburetorHistory(store);
        store.remove();
        for (const [inverse, expected] of [
            [true, ['first', 'middle', 'last', 'row', 'map', 'items']],
            [false, ['middle', 'last', 'row', 'map', 'items']],
        ] as const) {
            expect(inverse ? history.undo() : history.redo()).toBe(true);
            const current = store.getData();
            expect(Object.keys(current)).toEqual(expected);
            expect(current.map.get(current.row)).toBe(current.row);
            expect(Object.getOwnPropertyDescriptor(current.map, 'owner')).toMatchObject({
                value: current, writable: false, enumerable: false, configurable: true,
            });
            expect(Object.getOwnPropertyDescriptor(current.items, 'length')?.writable).toBe(false);
        }
        history.disconnect();
    });

    test('a canceled order transition does not rewrite the previous snapshot endpoint', () => {
        const store = makeStore();
        const history = new CarburetorHistory(store);
        store.remove('first');
        store.mark(1);
        transaction(() => {
            store.move('middle');
            store.move('middle');
            // Moving it back requires a replacement in the original order.
            store.setData({middle: 2, last: 3, marker: 1});
        });
        expect(keys(store)).toEqual(['middle', 'last', 'marker']);
        expect(history.undo()).toBe(true);
        expect(keys(store)).toEqual(['middle', 'last', 'marker']);
        expect(store.getData().marker).toBe(0);
        expect(history.undo()).toBe(true);
        expect(keys(store)).toEqual(before);
        expect(history.undo()).toBe(false);
        history.disconnect();
    });

    test('clear splits a queued deletion from later changes without affecting an independent recorder', () => {
        const throttle = new ManualThrottle();
        const store = makeStore(throttle);
        const cleared = new CarburetorHistory(store);
        const other = new CarburetorHistory(store);
        store.remove('first');
        cleared.clear();
        throttle.flush();
        expect(cleared.undo()).toBe(false);
        store.mark(5);
        throttle.flush();
        expect(cleared.undo()).toBe(true);
        expect(keys(store)).toEqual(['middle', 'last', 'marker']);
        expect(store.getData().marker).toBe(0);
        throttle.flush();
        expect(other.undo()).toBe(true);
        expect(store.getData().marker).toBe(5);
        throttle.flush();
        expect(other.undo()).toBe(true);
        expect(store.getData().marker).toBe(0);
        throttle.flush();
        expect(other.undo()).toBe(true);
        expect(keys(store)).toEqual(before);
        cleared.disconnect();
        other.disconnect();
    });

    test('subscriber reentry branches from an owned-order replay', () => {
        const store = makeStore();
        const history = new CarburetorHistory(store);
        store.remove('first');
        let nested = false;
        const subscription = store.subscribe(() => {
            if (!nested && keys(store).join() === before.join()) {
                nested = true;
                store.mark(8);
            }
        });
        expect(history.undo()).toBe(true);
        expect(keys(store)).toEqual(before);
        expect(store.getData().marker).toBe(8);
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(store.getData().marker).toBe(0);
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test('restore rejection preserves the cursor and cannot leak the owned replay flag', () => {
        class Guarded extends OrderedStore {
            public reject = false;
            public override restore(state: {first?: number; middle?: number; last: number; marker: number}): void {
                if (this.reject) throw new Error('rejected restore');
                super.restore(state);
            }
        }
        const store = new Guarded({first: 1, middle: 2, last: 3, marker: 0});
        const history = new CarburetorHistory(store);
        store.remove('first');
        store.reject = true;
        expect(() => history.undo()).toThrow('rejected restore');
        expect(keys(store)).toEqual(['middle', 'last', 'marker']);
        store.reject = false;
        expect(history.undo()).toBe(true);
        expect(keys(store)).toEqual(before);
        expect(history.redo()).toBe(true);
        expect(keys(store)).toEqual(['middle', 'last', 'marker']);
        store.mark(6);
        expect(history.undo()).toBe(true);
        expect(store.getData().marker).toBe(0);
        history.disconnect();
    });
});

type DocsState = {docs: Record<string, {title: string} | null>; rows: {title: string}[]};

type PlanState = {first?: number; second?: number; middle?: number; last: number; marker: number};

// --- pending owned-target fold (search index) ---

class DocsCarburetor extends Carburetor<DocsState> {
    public edit(mutate: (draft: DocsState) => void): void {
        this.update(mutate);
    }
}

const buildRows = (): {title: string}[] => Array.from({length: 8}, (_, index) => ({title: `row-${index}`}));

describe('pending owned-target fold', () => {
    test('a write under a freshly added branch merges into the owned endpoint', () => {
        const rows = buildRows();
        const store = new DocsCarburetor({docs: {}, rows});
        const history = new CarburetorHistory(store);
        const baselineRows = (history as unknown as {baseline: {rows: {title: string}[]}}).baseline.rows;
        store.edit(draft => {
            draft.docs.entry = {title: 'first'};
            draft.docs.entry.title = 'final';
        });
        const entry = (history as unknown as {past: Array<{kind: string; patches?: unknown[]}>}).past.at(-1)!;
        expect(entry.kind).toBe('patches');
        expect(entry.patches).toHaveLength(1);
        expect((entry.patches![0] as {next: {title: string}}).next).toEqual({title: 'final'});
        expect((history as unknown as {baseline: {rows: unknown}}).baseline.rows).toBe(baselineRows);
        expect(store.getData().rows).toBe(rows);
        expect(store.getData().docs.entry).toEqual({title: 'final'});
        expect(history.undo()).toBe(true);
        expect(store.getData().docs).toEqual({});
        expect(history.redo()).toBe(true);
        expect(store.getData().docs.entry).toEqual({title: 'final'});
        history.disconnect();
    });

    test('deleting a folded branch keeps undo exact through repeated cycles', () => {
        const store = new DocsCarburetor({docs: {}, rows: buildRows()});
        const history = new CarburetorHistory(store);
        store.edit(draft => {
            draft.docs.entry = {title: 'first'};
            delete draft.docs.entry;
        });
        expect(store.getData().docs).toEqual({});
        expect(history.undo()).toBe(true);
        expect(store.getData().docs).toEqual({});
        expect(history.redo()).toBe(true);
        expect(store.getData().docs).toEqual({});
        store.edit(draft => {
            draft.docs.entry = {title: 'kept'};
            draft.docs.entry.title = 'edited';
            delete draft.docs.entry;
            draft.docs.entry = {title: 'again'};
            draft.docs.entry.title = 'last';
        });
        expect(store.getData().docs.entry).toEqual({title: 'last'});
        for (let cycle = 0; cycle < 2; cycle++) {
            expect(history.undo()).toBe(true);
            expect(store.getData().docs).toEqual({});
            expect(history.redo()).toBe(true);
            expect(store.getData().docs.entry).toEqual({title: 'last'});
        }
        history.disconnect();
    });

    test('a same-path replacement folds to the final endpoint over an older owned copy', () => {
        const store = new DocsCarburetor({docs: {}, rows: buildRows()});
        const history = new CarburetorHistory(store);
        store.edit(draft => {
            draft.docs.entry = {title: 'one'};
            draft.docs.entry.title = 'two';
            draft.docs.entry = {title: 'three'};
        });
        const entry = (history as unknown as {past: Array<{kind: string; patches?: unknown[]}>}).past.at(-1)!;
        expect(entry.kind).toBe('patches');
        expect(entry.patches).toHaveLength(1);
        expect((entry.patches![0] as {next: {title: string}}).next).toEqual({title: 'three'});
        expect(history.undo()).toBe(true);
        expect(store.getData().docs).toEqual({});
        expect(history.redo()).toBe(true);
        expect(store.getData().docs.entry).toEqual({title: 'three'});
        history.disconnect();
    });
});

// --- order-carrying deletion plans ---

class PlanOrderedStore extends Carburetor<PlanState> {
    public remove(key: 'first' | 'second' | 'middle'): void {
        this.update(draft => { delete draft[key]; });
    }
    public bulkRemove(): void {
        this.update(draft => {
            delete draft.first;
            delete draft.second;
            delete draft.middle;
        });
    }
    public mark(value: number): void {
        this.update(draft => { draft.marker = value; });
    }
}

const planBefore = ['first', 'second', 'middle', 'last', 'marker'];
const makePlanStore = (): PlanOrderedStore =>
    new PlanOrderedStore({first: 1, second: 2, middle: 3, last: 4, marker: 0});
const planKeysOf = (store: PlanOrderedStore): string[] => Object.keys(store.getData());
const entryOf = (history: CarburetorHistory<PlanState>):
    {kind: string} => (history as unknown as {past: Array<{kind: string}>}).past.at(-1)!;

describe('middle-key deletions stay patch entries with ordered undo', () => {
    test('a middle-key deletion records a patches entry and undo reinstalls its position', () => {
        const store = makePlanStore();
        const history = new CarburetorHistory(store);
        store.remove('first');
        expect(entryOf(history).kind).toBe('patches');
        expect(planKeysOf(store)).toEqual(['second', 'middle', 'last', 'marker']);
        expect(history.undo()).toBe(true);
        expect(planKeysOf(store)).toEqual(planBefore);
        expect(store.getData().first).toBe(1);
        expect(history.redo()).toBe(true);
        expect(planKeysOf(store)).toEqual(['second', 'middle', 'last', 'marker']);
        history.disconnect();
    });

    test('the last ordered key deletion keeps its plain append undo', () => {
        const store = makePlanStore();
        const history = new CarburetorHistory(store);
        store.update(draft => { delete draft.marker; });
        expect(entryOf(history).kind).toBe('patches');
        expect(history.undo()).toBe(true);
        expect(planKeysOf(store)).toEqual(planBefore);
        expect(history.redo()).toBe(true);
        expect(planKeysOf(store)).toEqual(['first', 'second', 'middle', 'last']);
        history.disconnect();
    });

    test('bulk middle deletions produce one patches entry whose undo restores every position', () => {
        const store = makePlanStore();
        const history = new CarburetorHistory(store);
        store.bulkRemove();
        expect(entryOf(history).kind).toBe('patches');
        expect(planKeysOf(store)).toEqual(['last', 'marker']);
        expect(history.undo()).toBe(true);
        expect(planKeysOf(store)).toEqual(planBefore);
        expect(store.getData().first).toBe(1);
        expect(store.getData().second).toBe(2);
        expect(store.getData().middle).toBe(3);
        expect(history.redo()).toBe(true);
        expect(planKeysOf(store)).toEqual(['last', 'marker']);
        history.disconnect();
    });

    test('two histories on one store resolve their own private order plans', () => {
        const store = makePlanStore();
        const first = new CarburetorHistory(store);
        const second = new CarburetorHistory(store);
        store.remove('middle');
        const patchesOf = (history: CarburetorHistory<PlanState>): Array<Record<string, unknown>> =>
            ((history as unknown as {past: Array<{patches?: unknown[]}>}).past.at(-1)!.patches ?? []);
        expect(entryOf(first).kind).toBe('patches');
        expect(entryOf(second).kind).toBe('patches');
        expect(patchesOf(first)[0]).not.toBe(patchesOf(second)[0]);
        expect(patchesOf(first)[0].orderPlan).toBeDefined();
        expect(patchesOf(second)[0].orderPlan).toBeDefined();
        expect((patchesOf(first)[0].orderPlan as {from: number}).from)
            .toBe((patchesOf(second)[0].orderPlan as {from: number}).from);
        expect(first.undo()).toBe(true);
        expect(planKeysOf(store)).toEqual(planBefore);
        expect(store.getData().middle).toBe(3);
        first.disconnect();
        second.disconnect();
    });
});

describe('positional windows with explicit undefined and coerced arguments', () => {
    class ListStore extends Carburetor<{list: number[]}> {
        public edit(mutate: (draft: {list: number[]}) => void): void { this.update(mutate); }
    }

    const entryPatches = (history: CarburetorHistory<{list: number[]}>): string[][] => {
        const entry = (history as unknown as {past: Array<{patches?: Array<{segments: string[]}>}>}).past.at(-1);
        return entry?.kind === 'patches' ? entry.patches!.map(patch => [...patch.segments]) : [];
    };

    test('fill treats an explicit undefined end as the array length', () => {
        const store = new ListStore({list: [0, 1, 2, 3]});
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.list.fill(9, 1, undefined); });
        expect(store.getData().list).toEqual([0, 9, 9, 9]);
        expect(entryPatches(history).map(segments => segments.join('.')))
            .toEqual(['list.1', 'list.2', 'list.3']);
        expect(history.undo()).toBe(true);
        expect(store.getData().list).toEqual([0, 1, 2, 3]);
        expect(history.redo()).toBe(true);
        expect(store.getData().list).toEqual([0, 9, 9, 9]);
        expect(history.undo()).toBe(true);
        expect(store.getData().list).toEqual([0, 1, 2, 3]);
        history.disconnect();
    });

    test('copyWithin treats an explicit undefined end as the array length', () => {
        const store = new ListStore({list: [0, 1, 2, 3]});
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.list.copyWithin(0, 2, undefined); });
        expect(store.getData().list).toEqual([2, 3, 2, 3]);
        expect(entryPatches(history).map(segments => segments.join('.')))
            .toEqual(['list.0', 'list.1']);
        expect(history.undo()).toBe(true);
        expect(store.getData().list).toEqual([0, 1, 2, 3]);
        expect(history.redo()).toBe(true);
        expect(store.getData().list).toEqual([2, 3, 2, 3]);
        expect(history.undo()).toBe(true);
        expect(store.getData().list).toEqual([0, 1, 2, 3]);
        history.disconnect();
    });

    test('splice with an explicitly undefined deleteCount removes nothing', () => {
        const store = new ListStore({list: [0, 1, 2, 3]});
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.list.splice(0, undefined); });
        expect(store.getData().list).toEqual([0, 1, 2, 3]);
        expect(history.undo()).toBe(false);
        history.disconnect();
    });

    test('non-numeric index arguments skip the window and coerce only once', () => {
        const store = new ListStore({list: [0, 1, 2, 3]});
        const history = new CarburetorHistory(store);
        let calls = 0;
        const target = {valueOf: (): number => ++calls === 1 ? 2 : 0};
        store.edit(draft => { draft.list.copyWithin(target as unknown as number, 2, 3); });
        expect(calls).toBe(1);
        expect(store.getData().list).toEqual([0, 1, 2, 3]);
        expect(history.undo()).toBe(false);
        history.disconnect();

        const stable = new ListStore({list: [0, 1, 2, 3]});
        const stableHistory = new CarburetorHistory(stable);
        stable.edit(draft => { draft.list.copyWithin({valueOf: () => 0} as unknown as number, 2, 3); });
        expect(stable.getData().list).toEqual([2, 1, 2, 3]);
        expect(entryPatches(stableHistory).map(segments => segments.join('.'))).toEqual(['list.0']);
        expect(stableHistory.undo()).toBe(true);
        expect(stable.getData().list).toEqual([0, 1, 2, 3]);
        expect(stableHistory.redo()).toBe(true);
        expect(stable.getData().list).toEqual([2, 1, 2, 3]);
        stableHistory.disconnect();
    });
});

class ItemStore extends Carburetor<{item: {a: number; b: number; c: number}}> {
    public replace(next: {a: number; b: number; c: number}): void {
        this.update(draft => { draft.item = next; });
    }
}

describe('a branch replacement that reorders keys and changes a value', () => {
    test('undo and redo keep the key order of each side', () => {
        const store = new ItemStore({item: {a: 1, b: 2, c: 3}});
        const history = new CarburetorHistory(store);
        store.replace({b: 2, a: 1, c: 4});
        expect(Object.keys(store.getData().item)).toEqual(['b', 'a', 'c']);
        for (let i = 0; i < 2; i++) {
            expect(history.undo()).toBe(true);
            expect(store.getData().item).toEqual({a: 1, b: 2, c: 3});
            expect(Object.keys(store.getData().item)).toEqual(['a', 'b', 'c']);
            expect(history.redo()).toBe(true);
            expect(Object.keys(store.getData().item)).toEqual(['b', 'a', 'c']);
        }
        history.disconnect();
    });
});
