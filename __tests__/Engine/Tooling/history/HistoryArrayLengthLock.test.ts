import {Carburetor, CarburetorHistory, ComponentUpdateThrottle} from '@/Carburetor';

const writable = (array: unknown[]): boolean =>
    Object.getOwnPropertyDescriptor(array, 'length')!.writable!;

class Items extends Carburetor<{items: number[]; marker: number}> {
    public defineLength(descriptor: PropertyDescriptor): void {
        this.update(draft => { Object.defineProperty(draft.items, 'length', descriptor); });
    }
    public mark(value: number): void {
        this.update(draft => { draft.marker = value; });
    }
}

describe('array length descriptor history', () => {
    test('nested truncation and locking publish and replay both contents and writable flag', () => {
        const store = new Items({items: [1, 2], marker: 0});
        const history = new CarburetorHistory(store);
        let lengthWakes = 0;
        let siblingWakes = 0;
        store.subscribe(() => { lengthWakes++; }, {reads: new Set(['items.length'])});
        store.subscribe(() => { siblingWakes++; }, {reads: new Set(['marker'])});

        store.defineLength({value: 1, writable: false});
        expect(store.getData().items).toEqual([1]);
        expect(writable(store.getData().items)).toBe(false);
        expect(lengthWakes).toBe(1);
        expect(siblingWakes).toBe(0);
        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2]);
        expect(writable(store.getData().items)).toBe(true);
        expect(history.redo()).toBe(true);
        expect(store.getData().items).toEqual([1]);
        expect(writable(store.getData().items)).toBe(false);
        expect(lengthWakes).toBe(3);
        expect(siblingWakes).toBe(0);
        history.disconnect();
    });

    test('descriptor-only lock has a real publication and history step', () => {
        const store = new Items({items: [1, 2], marker: 0});
        const history = new CarburetorHistory(store);
        let wakes = 0;
        store.subscribe(() => { wakes++; }, {reads: new Set(['items.length'])});
        store.defineLength({writable: false});
        expect(store.getVersion()).toBe(1);
        expect(wakes).toBe(1);
        expect(writable(store.getData().items)).toBe(false);
        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2]);
        expect(writable(store.getData().items)).toBe(true);
        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(true);
        expect(writable(store.getData().items)).toBe(false);
        expect(wakes).toBe(3);
        history.disconnect();
    });

    test('root array preserves sparse holes and ownership on each replay', () => {
        const items: number[] = [1, 2];
        items.length = 4;
        items[3] = 4;
        const store = new Carburetor(items);
        const history = new CarburetorHistory(store);
        store.update(draft => { Object.defineProperty(draft, 'length', {value: 1, writable: false}); });
        expect(history.undo()).toBe(true);
        expect(store.getData().length).toBe(4);
        expect(store.getData()[1]).toBe(2);
        expect(2 in store.getData()).toBe(false);
        expect(store.getData()[3]).toBe(4);
        expect(writable(store.getData())).toBe(true);
        expect(history.redo()).toBe(true);
        expect(store.getData().length).toBe(1);
        expect(writable(store.getData())).toBe(false);
        history.disconnect();
    });

    test('partial failure at a non-configurable index records the actual locked result', () => {
        const items = [1, 2, 3, 4];
        Object.defineProperty(items, '1', {value: 2, writable: true, enumerable: true, configurable: false});
        const store = new Items({items, marker: 0});
        const history = new CarburetorHistory(store);
        expect(() => store.defineLength({value: -1, writable: false})).toThrow(RangeError);
        expect(history.canUndo()).toBe(false);
        expect(() => store.defineLength({value: 0, writable: false})).toThrow(TypeError);
        expect(store.getData().items).toEqual([1, 2]);
        expect(writable(store.getData().items)).toBe(false);
        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2, 3, 4]);
        expect(writable(store.getData().items)).toBe(true);
        expect(history.redo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2]);
        expect(writable(store.getData().items)).toBe(false);
        expect(() => store.defineLength({value: 3})).toThrow(TypeError);
        expect(history.canUndo()).toBe(true);
        history.disconnect();
    });

    test('an owned native root backlink and plain Map entry remain joined across length replay', () => {
        const row = {id: 1};
        const root = {items: [1, 2], row, map: new Map<object, object>([[row, row]])};
        Object.defineProperty(root.map, 'owner', {value: root, configurable: true});
        const store = new Carburetor(root);
        const history = new CarburetorHistory(store);
        store.update(draft => { Object.defineProperty(draft.items, 'length', {value: 1, writable: false}); });
        for (const [reverse, length] of [[true, 2], [false, 1]] as const) {
            expect(reverse ? history.undo() : history.redo()).toBe(true);
            const state = store.getData();
            expect(state.items.length).toBe(length);
            expect(writable(state.items)).toBe(reverse);
            expect(state.map.get(state.row)).toBe(state.row);
            expect(Object.getOwnPropertyDescriptor(state.map, 'owner')?.value).toBe(state);
        }
        history.disconnect();
    });

    test('queued replay and an independent recorder retain their actual earlier state', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ManualThrottle();
        const store = new Items({items: [1, 2], marker: 0}, throttle);
        const first = new CarburetorHistory(store);
        const second = new CarburetorHistory(store);
        store.mark(1);
        throttle.flush();
        store.defineLength({value: 1, writable: false});
        expect(first.undo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2]);
        expect(writable(store.getData().items)).toBe(true);
        throttle.flush();
        expect(second.undo()).toBe(true);
        expect(store.getData().marker).toBe(0);
        expect(second.undo()).toBe(false);
        first.disconnect();
        second.disconnect();
    });

    test('clearing one queued lock publication keeps later edits and the independent recorder', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ManualThrottle();
        const store = new Items({items: [1, 2], marker: 0}, throttle);
        const cleared = new CarburetorHistory(store);
        const other = new CarburetorHistory(store);
        store.defineLength({value: 1, writable: false});
        cleared.clear();
        throttle.flush();
        expect(cleared.canUndo()).toBe(false);
        store.mark(5);
        throttle.flush();
        expect(cleared.undo()).toBe(true);
        expect(store.getData().marker).toBe(0);
        expect(store.getData().items).toEqual([1]);
        expect(writable(store.getData().items)).toBe(false);
        throttle.flush();
        expect(other.undo()).toBe(true);
        expect(store.getData().marker).toBe(5);
        throttle.flush();
        expect(other.undo()).toBe(true);
        expect(store.getData().marker).toBe(0);
        throttle.flush();
        expect(other.undo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2]);
        expect(writable(store.getData().items)).toBe(true);
        cleared.disconnect();
        other.disconnect();
    });

    test('a whole-state replacement with a locked array retains its descriptor in both directions', () => {
        const store = new Items({items: [1, 2], marker: 0});
        const history = new CarburetorHistory(store);
        const items = [1];
        Object.defineProperty(items, 'length', {writable: false});
        store.setData({items, marker: 1});
        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2]);
        expect(writable(store.getData().items)).toBe(true);
        expect(store.getData().marker).toBe(0);
        expect(history.redo()).toBe(true);
        expect(store.getData().items).toEqual([1]);
        expect(writable(store.getData().items)).toBe(false);
        expect(store.getData().marker).toBe(1);
        history.disconnect();
    });

    test('replacing an array with equally valued but locked data is not a no-op', () => {
        const store = new Items({items: [1, 2], marker: 0});
        const history = new CarburetorHistory(store);
        const locked = [1, 2];
        Object.defineProperty(locked, 'length', {writable: false});
        store.update(draft => { draft.items = locked; });
        expect(store.getVersion()).toBe(1);
        expect(history.canUndo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(writable(store.getData().items)).toBe(true);
        expect(history.redo()).toBe(true);
        expect(writable(store.getData().items)).toBe(false);
        history.disconnect();
    });

    test('a locked baseline survives a plain patch and remains exact after removing the lock', () => {
        const items = [1, 2];
        Object.defineProperty(items, 'length', {writable: false});
        const store = new Items({items, marker: 0});
        const history = new CarburetorHistory(store);
        store.mark(1);
        store.update(draft => { draft.items = [3, 4]; });
        store.setData({items: [5], marker: 2});

        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([3, 4]);
        expect(writable(store.getData().items)).toBe(true);
        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2]);
        expect(writable(store.getData().items)).toBe(false);
        expect(store.getData().marker).toBe(1);
        expect(history.undo()).toBe(true);
        expect(store.getData().marker).toBe(0);
        expect(writable(store.getData().items)).toBe(false);
        expect(history.redo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(store.getData().items).toEqual([5]);
        expect(writable(store.getData().items)).toBe(true);
        history.disconnect();
    });

    test('failed pre-install undo and redo preserve their cursor and unchanged live state', () => {
        class Guarded extends Items {
            public reject = false;
            public restore(data: {items: number[]; marker: number}): void {
                if (this.reject) throw new Error('restore refused');
                super.restore(data);
            }
        }
        const store = new Guarded({items: [1, 2], marker: 0});
        const history = new CarburetorHistory(store);
        store.defineLength({value: 1, writable: false});
        store.reject = true;
        const locked = store.getData();
        expect(() => history.undo()).toThrow('restore refused');
        expect(store.getData()).toBe(locked);
        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(false);
        store.reject = false;
        expect(history.undo()).toBe(true);
        store.reject = true;
        const unlocked = store.getData();
        expect(() => history.redo()).toThrow('restore refused');
        expect(store.getData()).toBe(unlocked);
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(true);
        store.reject = false;
        expect(history.redo()).toBe(true);
        expect(store.getData().items).toEqual([1]);
        expect(writable(store.getData().items)).toBe(false);
        history.disconnect();
    });
});

// Replay subscribers must be allowed to branch while a descriptor transition is installed.
describe('locked array replay branches', () => {
    test('a subscriber write after undo invalidates redo without losing the new branch', () => {
        const store = new Items({items: [1, 2], marker: 0});
        const history = new CarburetorHistory(store);
        store.defineLength({value: 1, writable: false});
        let branched = false;
        const id = store.subscribe(() => {
            if (!branched && store.getData().items.length === 2) {
                branched = true;
                store.mark(7);
            }
        });
        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2]);
        expect(store.getData().marker).toBe(7);
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(store.getData().marker).toBe(0);
        expect(history.undo()).toBe(false);
        store.unsubscribe(id);
        history.disconnect();
    });
});
