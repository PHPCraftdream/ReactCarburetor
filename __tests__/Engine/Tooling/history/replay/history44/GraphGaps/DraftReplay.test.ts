import {Carburetor, CarburetorHistory} from '@/Carburetor';

interface IState {value: number; nested: {flag: boolean};}
class Store extends Carburetor<IState> {
    public change(): void { this.update(draft => { draft.value = 2; }); }
}

describe('applyPatchesEntryOnDraft', () => {
    test('undoes and redoes a public scalar history entry', () => {
        const store = new Store({value: 1, nested: {flag: false}});
        const history = new CarburetorHistory(store);
        try {
            store.change();
            expect(store.getData().value).toBe(2);
            expect(history.undo()).toBe(true);
            expect(store.getData().value).toBe(1);
            expect(history.redo()).toBe(true);
            expect(store.getData().value).toBe(2);
            expect(history.undo()).toBe(true);
            expect(store.getData().value).toBe(1);
        } finally { history.disconnect(); }
    });
});
