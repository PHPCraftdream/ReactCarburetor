import {Carburetor, CarburetorHistory} from '@/Carburetor';

describe('CarburetorHistory', () => {
    test('failed restore clears replay ownership and retains the undo entry', () => {
        const store = new Carburetor<{value: number}>({value: 0});
        const history = new CarburetorHistory(store);
        store.update(draft => { draft.value = 1; });
        const restore = store.restore.bind(store);
        store.restore = state => {
            if ((state as {value: number}).value === 0) throw new Error('restore failed');
            restore(state);
        };
        expect(() => history.undo()).toThrow('restore failed');
        expect(history.canUndo()).toBe(true);
        store.restore = restore;
        expect(history.undo()).toBe(true);
        expect(store.getData().value).toBe(0);
    });
    test('clear resets history and disconnect stops recording', () => {
        const store = new Carburetor<{value: number}>({value: 0});
        const history = new CarburetorHistory(store);
        store.update(draft => { draft.value = 1; });
        expect(history.undo()).toBe(true);
        expect(store.getData().value).toBe(0);
        expect(history.redo()).toBe(true);
        expect(store.getData().value).toBe(1);
        history.clear();
        expect(history.canUndo()).toBe(false);
        store.update(draft => { draft.value = 2; });
        expect(history.undo()).toBe(true);
        history.disconnect();
        store.update(draft => { draft.value = 3; });
        expect(history.canUndo()).toBe(false);
    });
    test('bounds undo history and clears redo when a new change follows undo', () => {
        const store = new Carburetor<{value: number}>({value: 0});
        const history = new CarburetorHistory(store, {limit: 2});
        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(false);
        store.update(draft => { draft.value = 1; });
        store.update(draft => { draft.value = 2; });
        store.update(draft => { draft.value = 3; });
        expect(history.undo()).toBe(true);
        expect(store.getData().value).toBe(2);
        expect(history.undo()).toBe(true);
        expect(store.getData().value).toBe(1);
        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(true);
        store.update(draft => { draft.value = 4; });
        expect(history.canRedo()).toBe(false);
        expect(history.redo()).toBe(false);
    });

    test('rejects invalid history limits', () => {
        const store = new Carburetor<{value: number}>({value: 0});
        expect(() => new CarburetorHistory(store, {limit: 0})).toThrow(RangeError);
        expect(() => new CarburetorHistory(store, {limit: 1.5})).toThrow(RangeError);
    });
});
