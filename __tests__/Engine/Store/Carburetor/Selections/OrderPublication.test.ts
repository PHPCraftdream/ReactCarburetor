import {Carburetor} from '@/Carburetor';
import {PATCH_KEY_ORDER_CHANGE, PATCH_OPAQUE, TPath} from '@/Carburetor/Models/Paths';
import {CARBURETOR_HAS_DRIFT, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';

class OrderedStore extends Carburetor<{item: Record<string, number>; leaf: number}> {
    public move(key: string): void {
        this.update(draft => {
            const value = draft.item[key];
            delete draft.item[key];
            draft.item[key] = value;
        });
    }
    public remove(key: string): void {
        this.update(draft => { delete draft.item[key]; });
    }
    public replaceItem(item: Record<string, number>): void {
        this.update(draft => { draft.item = item; });
    }
    public changeItem(key: string, value: number): void {
        this.update(draft => { draft.item[key] = value; });
    }
    public changeLeaf(value: number): void {
        this.update(draft => { draft.leaf = value; });
    }
}

describe('ordered own keys in publications', () => {
    test('root and nested equal-entry replacements publish only enumeration, not unrelated leaves', () => {
        const store = new OrderedStore({item: {a: 1, b: 2}, leaf: 7});
        const reads = new Set<TPath>();
        Object.keys(store.read(path => reads.add(path)).item);
        let enumerator = 0;
        let leaf = 0;
        const seen: string[][] = [];
        store.subscribe(() => enumerator++, {id: 'keys', reads});
        store.subscribe(() => leaf++, {id: 'leaf', reads: new Set(['leaf'])});
        const stop = store.watch(data => Object.keys(data.item), keys => seen.push(keys));

        store.setData({item: {b: 2, a: 1}, leaf: 7});
        expect(store.getVersion()).toBe(1);
        expect(enumerator).toBe(1);
        expect(leaf).toBe(0);
        expect(seen).toEqual([['b', 'a']]);
        // hasDriftSince lives on the internal symbol protocol now (R30-06a).
        expect((store as IInternalSubscriptionProtocol)[CARBURETOR_HAS_DRIFT]!(0, reads)).toBe(true);
        expect((store as IInternalSubscriptionProtocol)[CARBURETOR_HAS_DRIFT]!(0, new Set(['leaf']))).toBe(false);

        store.setData({item: {b: 2, a: 1}, leaf: 7});
        expect(store.getVersion()).toBe(1);
        expect(enumerator).toBe(1);
        store.setData({leaf: 7, item: {b: 2, a: 1}});
        expect(store.getVersion()).toBe(2);
        expect(leaf).toBe(0);
        expect(enumerator).toBe(1);
        stop();
    });

    test('root key reorder and null-prototype escaped keys are tracked without leaf wakes', () => {
        const store = new Carburetor<Record<string, unknown>>({'a.b': 1, plain: 2});
        const observed: string[][] = [];
        const stop = store.watch(value => Object.keys(value), keys => observed.push(keys));
        store.setData({plain: 2, 'a.b': 1});
        expect(observed).toEqual([['plain', 'a.b']]);
        expect(store.getVersion()).toBe(1);
        stop();

        const dictionary = Object.assign(Object.create(null), {'a.b': 1, other: 2}) as Record<string, number>;
        const next = Object.assign(Object.create(null), {other: 2, 'a.b': 1}) as Record<string, number>;
        const nullStore = new Carburetor(dictionary);
        const nullKeys: string[][] = [];
        const stopNull = nullStore.watch(data => Object.keys(data), keys => nullKeys.push(keys));
        nullStore.setData(next);
        expect(nullKeys).toEqual([['other', 'a.b']]);
        stopNull();
    });

    test('matched draft reinsert publishes new detached spread ordering', () => {
        const store = new OrderedStore({item: {a: 1, b: 2}, leaf: 7});
        const observed: string[][] = [];
        const previous: string[][] = [];
        const stop = store.watch(data => ({...data.item}), (next, old) => {
            observed.push(Object.keys(next));
            previous.push(Object.keys(old));
        });
        store.move('a');
        expect(observed).toEqual([['b', 'a']]);
        expect(previous).toEqual([['a', 'b']]);
        stop();
    });

    test('a live branch selection retains leaf dependencies after an order-only publication', () => {
        const store = new OrderedStore({item: {a: 1, b: 2}, leaf: 7});
        const seen: Array<{keys: string[]; b: number}> = [];
        const stop = store.watch(data => data.item, next => {
            seen.push({keys: Object.keys(next), b: next.b});
        });
        store.move('a');
        store.changeItem('b', 3);
        expect(seen).toEqual([
            {keys: ['b', 'a'], b: 2},
            {keys: ['b', 'a'], b: 3},
        ]);
        stop();
    });

    test('reordered changed branches retain later leaf reads across publications', () => {
        const store = new OrderedStore({item: {a: 1, b: 1}, leaf: 0});
        const seen: Array<{keys: string[]; a: number; b: number}> = [];
        const stop = store.watch(data => data.item, next => {
            seen.push({keys: Object.keys(next), a: next.a, b: next.b});
        });
        store.setData({item: {b: 1, a: 2}, leaf: 0});
        store.changeItem('b', 2);
        store.changeItem('a', 3);
        expect(store.getData().item).toEqual({b: 2, a: 3});
        expect(seen).toEqual([
            {keys: ['b', 'a'], a: 2, b: 1},
            {keys: ['b', 'a'], a: 2, b: 2},
            {keys: ['b', 'a'], a: 3, b: 2},
        ]);
        stop();
    });

    test('only a positional string-key deletion signals owned replay', () => {
        const store = new OrderedStore({item: {a: 1, b: 2, c: 3}, leaf: 7});
        let orderChanges = 0;
        const detach = store.attachPatchListener({patch: value => {
            if (value === PATCH_KEY_ORDER_CHANGE) orderChanges++;
        }});
        store.changeLeaf(8);
        store.remove('c');
        expect(orderChanges).toBe(0);
        store.remove('a');
        expect(orderChanges).toBe(1);
        detach();

        const numeric = new OrderedStore({item: {'2': 2, '10': 10, tail: 1}, leaf: 0});
        const detachNumeric = numeric.attachPatchListener({patch: value => {
            if (value === PATCH_KEY_ORDER_CHANGE) orderChanges++;
        }});
        numeric.remove('2');
        expect(orderChanges).toBe(1);
        detachNumeric();
    });

    test('branch replacement signals only append-impossible order, not equal or numeric keys', () => {
        const store = new OrderedStore({item: {a: 1, b: 2}, leaf: 7});
        let orderChanges = 0;
        const detach = store.attachPatchListener({patch: value => {
            if (value === PATCH_KEY_ORDER_CHANGE) orderChanges++;
        }});
        store.replaceItem({a: 1, b: 2});
        expect(orderChanges).toBe(0);
        store.replaceItem({b: 2, a: 1});
        expect(orderChanges).toBe(1);
        detach();

        const numeric = new OrderedStore({item: {'2': 2, '10': 10, tail: 1}, leaf: 0});
        const detachNumeric = numeric.attachPatchListener({patch: value => {
            if (value === PATCH_KEY_ORDER_CHANGE) orderChanges++;
        }});
        numeric.replaceItem({'10': 10, '2': 2, tail: 1});
        expect(orderChanges).toBe(1);
        detachNumeric();
    });

    test('restore installs requested order without adopting the snapshot or partial writes', () => {
        const store = new OrderedStore({item: {a: 1, b: 2}, leaf: 7});
        const original = store.getData().item;
        const snapshot = {item: {b: 2, a: 1}, leaf: 7};
        const seen: string[][] = [];
        const stop = store.watch(data => Object.keys(data.item), next => seen.push(next));
        store.restore(snapshot);
        expect(Object.keys(store.getData().item)).toEqual(['b', 'a']);
        expect(seen).toEqual([['b', 'a']]);
        expect(store.getData().item).not.toBe(original);
        expect(store.getData()).not.toBe(snapshot);
        store.changeLeaf(8);
        expect(snapshot.leaf).toBe(7);
        stop();
    });

    test('nested order fallback chooses the snapshot before any earlier sibling is modified', () => {
        const store = new OrderedStore({leaf: 7, item: {a: 1, b: 2}});
        const requested = {leaf: 8, item: {b: 2, a: 1}};
        let wakes = 0;
        const patches: unknown[] = [];
        const detach = store.attachPatchListener({patch: value => patches.push(value)});
        store.subscribe(() => wakes++, {id: 'leaf', reads: new Set(['leaf'])});
        store.restore(requested);
        expect(store.getVersion()).toBe(1);
        expect(wakes).toBe(1);
        expect(Object.keys(store.getData().item)).toEqual(['b', 'a']);
        expect(store.getData().leaf).toBe(8);
        expect(store.getData()).not.toBe(requested);
        expect(patches).toEqual([PATCH_OPAQUE]);
        detach();
    });
});
