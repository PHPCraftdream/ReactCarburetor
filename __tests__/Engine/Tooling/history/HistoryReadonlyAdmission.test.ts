import {Carburetor, CarburetorHistory, ComponentUpdateThrottle} from '@/Carburetor';

class Editable<T extends object> extends Carburetor<T> {
    public edit(change: (draft: T) => void): void { this.update(change); }
}

describe('owned baseline patch admission', () => {
    test('readonly leaf under a replaced branch retains both replay endpoints after a later patch', () => {
        const row = {x: 1};
        Object.defineProperty(row, 'x', {value: 1, enumerable: true, writable: false, configurable: true});
        const store = new Editable({row, other: 0});
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.row = {x: 2}; });
        expect(history.canUndo()).toBe(true);
        expect(store.getData().row.x).toBe(2);
        expect(history.undo()).toBe(true);
        expect(store.getData().row.x).toBe(1);
        expect(Object.getOwnPropertyDescriptor(store.getData().row, 'x')?.writable).toBe(false);
        expect(history.redo()).toBe(true);
        expect(store.getData().row.x).toBe(2);
        store.edit(draft => { draft.other = 7; });
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({row: {x: 2}, other: 0});
        expect(history.undo()).toBe(true);
        expect(store.getData().row.x).toBe(1);
        expect(Object.getOwnPropertyDescriptor(store.getData().row, 'x')?.writable).toBe(false);
        expect(history.redo()).toBe(true);
        expect(store.getData().row.x).toBe(2);
        history.disconnect();
    });

    test('non-configurable leaf removal from a replaced branch never damages the owned before endpoint', () => {
        const row = {keep: 1, remove: 2};
        Object.defineProperty(row, 'remove', {value: 2, writable: true, enumerable: true, configurable: false});
        const store = new Editable({row});
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.row = {keep: 1} as typeof row; });
        expect(history.undo()).toBe(true);
        expect(store.getData().row).toEqual({keep: 1, remove: 2});
        expect(Object.getOwnPropertyDescriptor(store.getData().row, 'remove')?.configurable).toBe(false);
        expect(history.redo()).toBe(true);
        expect(store.getData().row).toEqual({keep: 1});
        history.disconnect();
    });

    test('locked length growth through a replaced branch replays without a failed baseline write', () => {
        const items = [1];
        Object.defineProperty(items, 'length', {writable: false});
        const store = new Editable({items});
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.items = [1, 2]; });
        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([1]);
        expect(Object.getOwnPropertyDescriptor(store.getData().items, 'length')?.writable).toBe(false);
        expect(history.redo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2]);
        history.disconnect();
    });

    test('null-prototype branches and escaped keys retain a readonly leaf through later patches', () => {
        const dictionary = Object.create(null) as Record<string, {x: number}>;
        const value = {x: 1};
        Object.defineProperty(value, 'x', {value: 1, writable: false, enumerable: true, configurable: true});
        dictionary['a.b'] = value;
        const store = new Editable({dictionary, marker: 0});
        const history = new CarburetorHistory(store);
        const replacement = Object.create(null) as typeof dictionary;
        replacement['a.b'] = {x: 2};
        store.edit(draft => { draft.dictionary = replacement; });
        store.edit(draft => { draft.marker = 3; });
        expect(history.undo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData().dictionary)).toBe(null);
        expect(store.getData().dictionary['a.b'].x).toBe(1);
        expect(Object.getOwnPropertyDescriptor(store.getData().dictionary['a.b'], 'x')?.writable).toBe(false);
        expect(history.redo()).toBe(true);
        expect(store.getData().dictionary['a.b'].x).toBe(2);
        history.disconnect();
    });

    test('two queued replacements of one readonly leaf admit one complete owned step', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const row = {x: 1};
        Object.defineProperty(row, 'x', {value: 1, writable: false, enumerable: true, configurable: true});
        const throttle = new ManualThrottle();
        const store = new Editable({row}, throttle);
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.row = {x: 2}; });
        store.edit(draft => { draft.row = {x: 3}; });
        throttle.flush();
        expect(history.undo()).toBe(true);
        expect(store.getData().row.x).toBe(1);
        expect(Object.getOwnPropertyDescriptor(store.getData().row, 'x')?.writable).toBe(false);
        expect(history.redo()).toBe(true);
        expect(store.getData().row.x).toBe(3);
        history.disconnect();
    });

    test('independent queued observers and clear retain their cursor after readonly branch replacement', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const row = {x: 1};
        Object.defineProperty(row, 'x', {value: 1, writable: false, enumerable: true, configurable: true});
        const throttle = new ManualThrottle();
        const store = new Editable({row, other: 0}, throttle);
        const cleared = new CarburetorHistory(store);
        const other = new CarburetorHistory(store);
        store.edit(draft => { draft.row = {x: 2}; });
        cleared.clear();
        throttle.flush();
        expect(cleared.canUndo()).toBe(false);
        expect(other.undo()).toBe(true);
        expect(store.getData().row.x).toBe(1);
        expect(Object.getOwnPropertyDescriptor(store.getData().row, 'x')?.writable).toBe(false);
        cleared.disconnect();
        other.disconnect();
    });
});

describe('restore capability preflight for locked object branches', () => {
    test('changed locked branch after an earlier sibling replaces the root atomically', () => {
        const row = {n: 1};
        const initial = {other: 0, row};
        Object.defineProperty(initial, 'row', {value: row, writable: false, enumerable: true, configurable: false});
        const store = new Editable(initial);
        const snapshot = {other: 4, row: {n: 2}};
        const previous = store.getData();
        let publications = 0;
        store.subscribe(() => { publications++; });
        store.restore(snapshot);
        expect(store.getData()).toEqual(snapshot);
        expect(store.getData()).not.toBe(snapshot);
        expect(store.getData()).not.toBe(previous);
        expect(previous.other).toBe(0);
        expect(previous.row.n).toBe(1);
        expect(store.getVersion()).toBe(1);
        expect(publications).toBe(1);
        store.edit(draft => { draft.row.n = 9; });
        expect(snapshot.row.n).toBe(2);
    });

    test('nested locked branch rejects in-place restore before an earlier sibling can change', () => {
        const row = {n: 1};
        const group = {row};
        Object.defineProperty(group, 'row', {value: row, writable: false, enumerable: true, configurable: false});
        const initial = {other: 0, group};
        const store = new Editable(initial);
        const saved = {other: 4, group: {row: {n: 2}}};
        store.restore(saved);
        expect(store.getData()).toEqual(saved);
        expect(store.getData()).not.toBe(saved);
        expect(initial.other).toBe(0);
        expect(initial.group.row.n).toBe(1);
        expect(store.getVersion()).toBe(1);
    });

    test('unchanged locked child retains identity while a writable sibling takes the narrow path', () => {
        const row = {n: 1};
        const initial = {other: 0, row};
        Object.defineProperty(initial, 'row', {value: row, writable: false, enumerable: true, configurable: false});
        const store = new Editable(initial);
        store.restore({other: 3, row: {n: 1}});
        expect(store.getData()).toBe(initial);
        expect(store.getData().row).toBe(row);
        expect(store.getData().other).toBe(3);
        expect(store.getVersion()).toBe(1);
    });
});
