import {Carburetor, CarburetorHistory} from '@/Carburetor';

// R39-05: external aliases are diagnostic-only; baseline mutates selected during undo.
describe('R39-05 external alias characterization', () => {
    test('swap replay restores row values without promising external alias identity', () => {
        const a = {id: 'a'};
        const b = {id: 'b'};
        const store = new Carburetor({rows: [a, b], selected: a});
        const history = new CarburetorHistory(store);
        store.update(draft => { draft.rows = [draft.rows[1], draft.rows[0]]; });
        expect(store.getData().rows).toEqual([{id: 'b'}, {id: 'a'}]);
        expect(store.getData().selected).toBe(store.getData().rows[1]);
        expect(history.undo()).toBe(true);
        expect(store.getData().rows).toEqual([{id: 'a'}, {id: 'b'}]);
        expect(store.getData().selected).toBe(a);
        expect(store.getData().selected.id).toBe('a');
        expect(store.getData().selected).not.toBe(store.getData().rows[0]);
        expect(history.redo()).toBe(true);
        expect(store.getData().rows).toEqual([{id: 'b'}, {id: 'a'}]);
        expect(store.getData().selected).toBe(a);
        expect(store.getData().selected.id).toBe('a');
        expect(store.getData().selected).not.toBe(store.getData().rows[1]);
    });
});
