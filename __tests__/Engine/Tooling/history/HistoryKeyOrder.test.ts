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
